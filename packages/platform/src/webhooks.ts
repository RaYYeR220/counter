import { carts, disputes, events, logEvent, orders, shops, type Db, type Order, type OrderStatus } from "@counter/db";
import type { PayPal } from "@counter/paypal";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { markVoided } from "./fulfilment";
import { slugFromTrackingId } from "./onboarding";

/**
 * The webhook id PayPal's webhook simulator uses. Simulated deliveries carry
 * no verifiable signature, so with this id configured they are processed
 * unverified (and marked so). Never configure it in production.
 */
export const SIMULATOR_WEBHOOK_ID = "WEBHOOK_ID";

/** `events.shop_id` for deliveries that match no shop. */
export const PLATFORM_EVENTS = "_platform";

export interface WebhookDelivery {
  headers: Record<string, string | undefined>;
  /** The request body exactly as received; the signature covers these bytes. */
  rawBody: string;
  /** The id of the webhook this endpoint is registered as at PayPal. */
  webhookId: string;
}

export interface WebhookResult {
  ok: boolean;
  /** What the delivery did, e.g. `order.refunded`, `dispute.recorded`, `ignored`, `duplicate`, `bad_signature`. */
  handled: string;
  eventId?: string;
  eventType?: string;
  unverified?: boolean;
}

type Resource = Record<string, any>;

interface PayPalEvent {
  id: string;
  event_type: string;
  summary?: string;
  resource_type?: string;
  resource?: Resource;
}

interface Outcome {
  handled: string;
  shopId?: string;
  ref?: string | null;
  extra?: Record<string, unknown>;
}

const EVENT_TYPE = /^[A-Z0-9][A-Z0-9._-]{0,99}$/;

function parseEvent(rawBody: string): PayPalEvent | "invalid_json" | "invalid_event" {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return "invalid_json";
  }
  const e = parsed as Partial<PayPalEvent> | null;
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id || typeof e.event_type !== "string" || !EVENT_TYPE.test(e.event_type)) {
    return "invalid_event";
  }
  return { ...e, resource: e.resource && typeof e.resource === "object" ? e.resource : {} } as PayPalEvent;
}

/**
 * Handles one PayPal webhook delivery: checks the signature with PayPal,
 * drops repeats of an event already handled, applies it to orders, disputes
 * or shops, and logs it as a `paypal.<event_type>` event. Event types it does
 * not act on are logged and acknowledged. Database failures are thrown so the
 * endpoint answers 5xx and PayPal redelivers.
 */
export async function handlePayPalWebhook(
  db: Db,
  paypal: Pick<PayPal, "verifyWebhook"> | undefined,
  delivery: WebhookDelivery,
): Promise<WebhookResult> {
  const event = parseEvent(delivery.rawBody);
  if (typeof event === "string") return { ok: false, handled: event };
  const ids = { eventId: event.id, eventType: event.event_type };

  const unverified = delivery.webhookId === SIMULATOR_WEBHOOK_ID;
  if (!unverified) {
    if (!paypal) return { ok: false, handled: "unverifiable", ...ids };
    const valid = await paypal.verifyWebhook(delivery.headers, delivery.rawBody, delivery.webhookId);
    if (!valid) return { ok: false, handled: "bad_signature", ...ids };
  }
  const flag = unverified ? { unverified: true } : {};

  const type = `paypal.${event.event_type}`;
  if (await alreadyHandled(db, type, event.id)) return { ok: true, handled: "duplicate", ...ids, ...flag };

  const outcome = await apply(db, event);
  await logEvent(db, outcome.shopId ?? PLATFORM_EVENTS, type, outcome.ref ?? null, {
    event_id: event.id,
    summary: event.summary ?? null,
    resource_type: event.resource_type ?? null,
    resource_id: event.resource?.id ?? event.resource?.dispute_id ?? null,
    handled: outcome.handled,
    ...outcome.extra,
    ...flag,
  });
  return { ok: true, handled: outcome.handled, ...ids, ...flag };
}

async function alreadyHandled(db: Db, type: string, eventId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.type, type), sql`${events.payload} ->> 'event_id' = ${eventId}`))
    .limit(1);
  return Boolean(row);
}

async function apply(db: Db, event: PayPalEvent): Promise<Outcome> {
  const r = event.resource ?? {};
  switch (event.event_type) {
    case "CHECKOUT.ORDER.APPROVED":
      return checkoutApproved(db, r);
    case "PAYMENT.AUTHORIZATION.CREATED":
      return authorizationCreated(db, r);
    case "PAYMENT.AUTHORIZATION.VOIDED":
      return authorizationVoided(db, r);
    case "PAYMENT.CAPTURE.COMPLETED":
      return captureCompleted(db, r);
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED":
      return captureDenied(db, r);
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED":
      return captureRefunded(db, r, event.event_type);
    case "CUSTOMER.DISPUTE.CREATED":
    case "CUSTOMER.DISPUTE.UPDATED":
    case "CUSTOMER.DISPUTE.RESOLVED":
      return disputeChanged(db, r, event.event_type);
    case "MERCHANT.ONBOARDING.COMPLETED":
      return merchantOnboarded(db, r);
    case "MERCHANT.PARTNER-CONSENT.REVOKED":
      return merchantRevoked(db, r);
    default:
      return { handled: "ignored" };
  }
}

// ---------------------------------------------------------------------------
// Lookups

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

async function orderWhere(db: Db, where: SQL | undefined): Promise<Order | null> {
  const [row] = await db.select().from(orders).where(where).limit(1);
  return row ?? null;
}

async function findOrder(
  db: Db,
  ids: { captureId?: string | undefined; authorizationId?: string | undefined; paypalOrderId?: string | undefined },
): Promise<Order | null> {
  if (ids.captureId) {
    const o = await orderWhere(db, eq(orders.captureId, ids.captureId));
    if (o) return o;
  }
  if (ids.authorizationId) {
    const o = await orderWhere(db, eq(orders.authorizationId, ids.authorizationId));
    if (o) return o;
  }
  if (ids.paypalOrderId) return orderWhere(db, eq(orders.paypalOrderId, ids.paypalOrderId));
  return null;
}

function relatedIds(r: Resource): { orderId?: string; authorizationId?: string } {
  const rel = r.supplementary_data?.related_ids ?? {};
  return { orderId: str(rel.order_id), authorizationId: str(rel.authorization_id) };
}

async function transition(db: Db, id: string, from: OrderStatus[], patch: Partial<typeof orders.$inferInsert>): Promise<Order | null> {
  const [row] = await db
    .update(orders)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(orders.id, id), inArray(orders.status, from)))
    .returning();
  return row ?? null;
}

function cents(value: unknown): number | undefined {
  const v = str(value);
  if (!v || !/^\d+(\.\d{1,2})?$/.test(v)) return undefined;
  const [whole, frac = ""] = v.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function unmatched(handled: string, ref: string | null = null): Outcome {
  return { handled, ref };
}

// ---------------------------------------------------------------------------
// Payments

async function checkoutApproved(db: Db, r: Resource): Promise<Outcome> {
  const paypalOrderId = str(r.id);
  if (!paypalOrderId) return unmatched("ignored");
  const [cart] = await db
    .select({ id: carts.id, shopId: carts.shopId })
    .from(carts)
    .where(eq(carts.paypalOrderId, paypalOrderId))
    .limit(1);
  if (!cart) return unmatched("checkout.unmatched", paypalOrderId);
  return { handled: "checkout.approved", shopId: cart.shopId, ref: cart.id, extra: { paypal_order_id: paypalOrderId } };
}

async function authorizationCreated(db: Db, r: Resource): Promise<Outcome> {
  const order = await findOrder(db, { authorizationId: str(r.id), paypalOrderId: relatedIds(r).orderId });
  if (!order) return unmatched("order.unmatched");
  return { handled: "order.authorized", shopId: order.shopId, ref: order.id, extra: { status: str(r.status) ?? null } };
}

async function authorizationVoided(db: Db, r: Resource): Promise<Outcome> {
  const order = await findOrder(db, { authorizationId: str(r.id) });
  if (!order) return unmatched("order.unmatched");
  const { changed } = await markVoided(db, order.id, "authorization voided at PayPal", "paypal");
  return { handled: changed ? "order.voided" : "order.unchanged", shopId: order.shopId, ref: order.id };
}

async function captureCompleted(db: Db, r: Resource): Promise<Outcome> {
  const captureId = str(r.id);
  const rel = relatedIds(r);
  const order = await findOrder(db, { captureId, authorizationId: rel.authorizationId, paypalOrderId: rel.orderId });
  if (!order || !captureId) return unmatched("order.unmatched");
  const fees = (r.seller_receivable_breakdown?.platform_fees ?? []) as Array<{ amount?: { value?: string } }>;
  const feeCents = fees.reduce((sum, f) => sum + (cents(f.amount?.value) ?? 0), 0);
  const won = await transition(db, order.id, ["authorized"], { status: "captured", captureId, platformFeeCents: feeCents });
  if (!won) return { handled: "order.unchanged", shopId: order.shopId, ref: order.id };
  await logEvent(db, won.shopId, "order.captured", won.id, { capture_id: captureId, capture_status: str(r.status) ?? null, platform_fee_cents: feeCents, by: "paypal" });
  return { handled: "order.captured", shopId: won.shopId, ref: won.id };
}

async function captureDenied(db: Db, r: Resource): Promise<Outcome> {
  const rel = relatedIds(r);
  const order = await findOrder(db, { captureId: str(r.id), authorizationId: rel.authorizationId, paypalOrderId: rel.orderId });
  if (!order) return unmatched("order.unmatched");
  return { handled: "capture.denied", shopId: order.shopId, ref: order.id, extra: { capture_id: str(r.id) ?? null, status: str(r.status) ?? null } };
}

/** The capture a refund belongs to: its `up` link, e.g. `.../v2/payments/captures/<id>`. */
function refundedCaptureId(r: Resource): string | undefined {
  const links = (Array.isArray(r.links) ? r.links : []) as Array<{ rel?: string; href?: string }>;
  const up = links.find((l) => l.rel === "up" && l.href?.includes("/captures/"));
  const fromLink = up?.href?.split("/captures/")[1]?.split(/[/?#]/)[0];
  return fromLink || str(r.supplementary_data?.related_ids?.capture_id);
}

async function captureRefunded(db: Db, r: Resource, type: string): Promise<Outcome> {
  const captureId = refundedCaptureId(r) ?? str(r.id);
  const order = await findOrder(db, { captureId });
  if (!order) return unmatched("order.unmatched");
  const won = await transition(db, order.id, ["captured", "disputed"], { status: "refunded" });
  if (!won) return { handled: "order.unchanged", shopId: order.shopId, ref: order.id };
  await logEvent(db, won.shopId, "order.refunded", won.id, {
    refund_id: str(r.id) ?? null,
    amount_cents: cents(r.amount?.value) ?? null,
    capture_id: captureId ?? null,
    by: "paypal",
    reversal: type === "PAYMENT.CAPTURE.REVERSED",
  });
  return { handled: "order.refunded", shopId: won.shopId, ref: won.id };
}

// ---------------------------------------------------------------------------
// Disputes

/** Outcomes where the buyer kept the money. */
const BUYER_WON = new Set(["RESOLVED_BUYER_FAVOUR", "ACCEPTED"]);
/** Outcomes where the seller kept the money. */
const SELLER_KEPT = new Set(["RESOLVED_SELLER_FAVOUR", "CANCELED_BY_BUYER", "DENIED", "RESOLVED_WITH_PAYOUT"]);

/**
 * Records a dispute read from PayPal's API the way its webhook would, for a
 * dispute whose webhook has not arrived yet. True when it matched a shop.
 */
export async function recordDispute(db: Db, dispute: Resource): Promise<boolean> {
  const out = await disputeChanged(db, dispute, "CUSTOMER.DISPUTE.UPDATED");
  return out.handled === "dispute.recorded";
}

async function disputeChanged(db: Db, r: Resource, type: string): Promise<Outcome> {
  const disputeId = str(r.dispute_id) ?? str(r.id);
  if (!disputeId) return unmatched("dispute.unmatched");
  const txns = (Array.isArray(r.disputed_transactions) ? r.disputed_transactions : []) as Resource[];

  let order: Order | null = null;
  for (const t of txns) {
    order = await findOrder(db, { captureId: str(t.seller_transaction_id) });
    if (order) break;
  }
  let shopId = order?.shopId;
  if (!shopId) {
    const [known] = await db.select({ shopId: disputes.shopId }).from(disputes).where(eq(disputes.id, disputeId)).limit(1);
    shopId = known?.shopId;
  }
  if (!shopId) {
    const merchantIds = txns.map((t) => str(t.seller?.merchant_id)).filter((m): m is string => Boolean(m));
    if (merchantIds.length) {
      const [shop] = await db.select({ id: shops.id }).from(shops).where(inArray(shops.paypalMerchantId, merchantIds)).limit(1);
      shopId = shop?.id;
    }
  }
  if (!shopId) return unmatched("dispute.unmatched", disputeId);

  const resolved = type === "CUSTOMER.DISPUTE.RESOLVED";
  const status = str(r.status) ?? (resolved ? "RESOLVED" : "OPEN");
  const reason = str(r.reason) ?? null;
  const outcome = str(r.dispute_outcome?.outcome_code) ?? null;
  await db
    .insert(disputes)
    .values({ id: disputeId, shopId, orderId: order?.id ?? null, status, reason })
    .onConflictDoUpdate({
      target: disputes.id,
      set: {
        status,
        reason: sql`coalesce(excluded.reason, ${disputes.reason})`,
        orderId: sql`coalesce(${disputes.orderId}, excluded.order_id)`,
        updatedAt: sql`now()`,
      },
    });

  if (order) {
    if (!resolved) await transition(db, order.id, ["captured"], { status: "disputed" });
    else if (outcome && BUYER_WON.has(outcome)) await transition(db, order.id, ["captured", "disputed"], { status: "refunded" });
    else if (outcome && SELLER_KEPT.has(outcome)) await transition(db, order.id, ["disputed"], { status: "captured" });
  }
  return {
    handled: "dispute.recorded",
    shopId,
    ref: disputeId,
    extra: { order_id: order?.id ?? null, status, reason, outcome },
  };
}

// ---------------------------------------------------------------------------
// Merchants

async function shopFor(db: Db, r: Resource): Promise<string | undefined> {
  const slug = slugFromTrackingId(str(r.tracking_id));
  if (slug) {
    const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, slug)).limit(1);
    if (shop) return shop.id;
  }
  const merchantId = str(r.merchant_id);
  if (!merchantId) return undefined;
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.paypalMerchantId, merchantId)).limit(1);
  return shop?.id;
}

async function merchantOnboarded(db: Db, r: Resource): Promise<Outcome> {
  const shopId = await shopFor(db, r);
  const merchantId = str(r.merchant_id);
  if (!shopId || !merchantId) return unmatched("merchant.unmatched", merchantId ?? null);
  await db
    .update(shops)
    .set({
      paypalMerchantId: merchantId,
      onboardingStatus: sql`case when ${shops.onboardingStatus} = 'active' and ${shops.paypalMerchantId} = ${merchantId} then 'active' else 'pending' end`,
    })
    .where(eq(shops.id, shopId));
  return { handled: "merchant.onboarded", shopId, ref: merchantId };
}

async function merchantRevoked(db: Db, r: Resource): Promise<Outcome> {
  const shopId = await shopFor(db, r);
  if (!shopId) return unmatched("merchant.unmatched", str(r.merchant_id) ?? null);
  await db.update(shops).set({ onboardingStatus: "revoked" }).where(eq(shops.id, shopId));
  return { handled: "merchant.revoked", shopId, ref: str(r.merchant_id) ?? null };
}
