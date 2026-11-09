import { carts, disputes, events, getShop, logEvent, negotiations, orders, shops as shopTable, type Db, type Order, type Tracking } from "@counter/db";
import { PayPalApiError, type PayPal } from "@counter/paypal";
import { fmt, type PayPalCart } from "@counter/store-sync";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { PlatformError } from "./errors";
import { loadOrder } from "./fulfilment";
import { accountForOrder, type ShopAccounts } from "./payments";
import { recordDispute } from "./webhooks";
import { renderPdf, type PdfLine } from "./pdf";

export const DISPUTE_REASON = {
  notReceived: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  notAsDescribed: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
  unauthorised: "UNAUTHORISED",
} as const;

export type EvidenceType = "PROOF_OF_FULFILLMENT" | "PROOF_OF_REFUND" | "OTHER";

export interface RequestedItem {
  variant_id: string;
  quantity: number;
  selected_attributes?: { name: string; value: string }[];
}

/** What the buying agent asked the shop for. */
export interface AgentRequest {
  items: RequestedItem[];
  /** `recorded`: the request body as the agent sent it; `cart`: the cart the agent confirmed at checkout. */
  source: "recorded" | "cart";
  agentClient?: string | null;
  at?: string;
}

/** The parts of a stored cart a dispute decision reads. */
export interface DisputeCart {
  id: string;
  cart: PayPalCart;
  agentClient?: string | null;
  createdAt?: Date;
}

export interface NegotiationSummary {
  outcome?: string | null;
  finalUnitCents?: number | null;
  turns: { from: string; text: string }[];
}

export interface DisputeContext {
  negotiation?: NegotiationSummary | null;
  tracking?: Tracking | null;
  agentClient?: string | null;
  /** The agent's request; defaults to the cart it confirmed at checkout. */
  request?: AgentRequest | null;
}

export interface DisputeDecision {
  action: "fight" | "accept";
  reason: string;
  /** Evidence to submit when fighting; null when accepting. */
  evidenceType: EvidenceType | null;
}

const fight = (evidenceType: EvidenceType, reason: string): DisputeDecision => ({ action: "fight", reason, evidenceType });
const accept = (reason: string): DisputeDecision => ({ action: "accept", reason, evidenceType: null });

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** The agent's request as the cart it confirmed: Store Sync prices exactly the variants and quantities the agent sent. */
export function requestFromCart(cart: DisputeCart): AgentRequest {
  const items = (cart.cart.items ?? [])
    .filter((i) => i.variant_id && i.quantity > 0)
    .map((i) => ({
      variant_id: i.variant_id!,
      quantity: i.quantity,
      ...(i.selected_attributes?.length
        ? { selected_attributes: i.selected_attributes.map((a) => ({ name: a.name ?? "", value: a.value ?? "" })) }
        : {}),
    }));
  return { items, source: "cart", agentClient: cart.agentClient ?? null };
}

interface Tally {
  quantity: number;
  attributes: Map<string, string>;
}

function tally(items: Array<{ variant_id?: string | null; quantity: number; selected_attributes?: Array<{ name?: string; value?: string }> | null }>) {
  const out = new Map<string, Tally>();
  for (const i of items) {
    if (!i.variant_id) continue;
    const t = out.get(i.variant_id) ?? { quantity: 0, attributes: new Map<string, string>() };
    t.quantity += i.quantity;
    for (const a of i.selected_attributes ?? []) if (a.name) t.attributes.set(norm(a.name), norm(a.value ?? ""));
    out.set(i.variant_id, t);
  }
  return out;
}

/** Every way the cart differs from the agent's request; empty when they match exactly. */
export function requestDifferences(cart: PayPalCart, request: AgentRequest): string[] {
  const have = tally(cart.items ?? []);
  const want = tally(request.items);
  if (want.size === 0) return ["the request lists no items"];
  const diffs: string[] = [];
  for (const [variant, w] of want) {
    const h = have.get(variant);
    if (!h) {
      diffs.push(`${variant} was requested but is not in the order`);
      continue;
    }
    if (h.quantity !== w.quantity) diffs.push(`${variant}: requested ${w.quantity}, order has ${h.quantity}`);
    for (const [name, value] of w.attributes) {
      const got = h.attributes.get(name);
      if (got !== value) diffs.push(`${variant}: requested ${name} ${value}, order has ${got ?? "none"}`);
    }
  }
  for (const variant of have.keys()) if (!want.has(variant)) diffs.push(`${variant} is in the order but was not requested`);
  return diffs;
}

/**
 * Decides how to answer a dispute, from the order's own record only:
 * - already refunded: fight with proof of refund;
 * - item not received: fight with proof of fulfilment if it shipped with tracking, else accept;
 * - not as described: fight if the order holds exactly what the agent asked for, else accept;
 * - unauthorised: fight if the buyer approved the payment in PayPal, else accept;
 * - anything else: fight with proof of fulfilment if it shipped, else accept.
 */
export function decideDispute(
  order: Pick<Order, "status" | "payerId" | "tracking">,
  cart: DisputeCart,
  dispute: { reason?: string | null },
  context: DisputeContext = {},
): DisputeDecision {
  if (order.status === "refunded") return fight("PROOF_OF_REFUND", "The order was already refunded to the buyer.");

  const tracking = context.tracking ?? order.tracking ?? null;
  const shipped = Boolean(tracking?.trackingNumber?.trim());
  const shipment = shipped ? `Shipped with ${tracking!.carrier}, tracking number ${tracking!.trackingNumber}.` : "";

  switch (dispute.reason) {
    case DISPUTE_REASON.notReceived:
      return shipped ? fight("PROOF_OF_FULFILLMENT", shipment) : accept("The order has not shipped, so the buyer gets a refund.");

    case DISPUTE_REASON.notAsDescribed: {
      const request = context.request ?? requestFromCart(cart);
      const diffs = requestDifferences(cart.cart, request);
      if (diffs.length) return accept(`The order differs from what the buying agent asked for: ${diffs.join("; ")}.`);
      return fight(
        "OTHER",
        request.source === "recorded"
          ? "The order holds exactly the items, quantities and options the buying agent asked for."
          : "The order holds exactly the items, quantities and options the buying agent confirmed at checkout.",
      );
    }

    case DISPUTE_REASON.unauthorised:
      if (!order.payerId) return accept("There is no PayPal payer approval on record for this order.");
      return fight(
        shipped ? "PROOF_OF_FULFILLMENT" : "OTHER",
        `The buyer approved this payment in PayPal (payer ${order.payerId}).${shipped ? ` ${shipment}` : ""}`,
      );

    default:
      return shipped
        ? fight("PROOF_OF_FULFILLMENT", shipment)
        : accept(`There is no shipment to show against a ${dispute.reason ?? "dispute"} claim, so the buyer gets a refund.`);
  }
}

// ---------------------------------------------------------------------------
// Agent requests

function requestedItems(body: unknown): RequestedItem[] {
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return [];
    }
  }
  const items = (parsed as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: RequestedItem[] = [];
  for (const raw of items as Array<Record<string, unknown>>) {
    const variant = typeof raw?.variant_id === "string" ? raw.variant_id : undefined;
    const quantity = raw?.quantity;
    if (!variant || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) continue;
    const attrs = Array.isArray(raw.selected_attributes)
      ? (raw.selected_attributes as Array<Record<string, unknown>>)
          .filter((a) => typeof a?.name === "string" && typeof a?.value === "string")
          .map((a) => ({ name: a.name as string, value: a.value as string }))
      : [];
    out.push({ variant_id: variant, quantity, ...(attrs.length ? { selected_attributes: attrs } : {}) });
  }
  return out;
}

/**
 * Keeps what the buying agent asked for (variant ids, quantities and the
 * options it named, nothing about the buyer) with the cart, as a
 * `cart.request` event. Call it with each Store Sync create/replace body.
 */
export async function recordAgentRequest(
  db: Db,
  p: { shopId: string; cartId: string; body: unknown; agentClient?: string | null },
): Promise<AgentRequest | null> {
  const items = requestedItems(p.body);
  if (items.length === 0) return null;
  const row = await logEvent(db, p.shopId, "cart.request", p.cartId, { items, agent: p.agentClient ?? null });
  return { items, source: "recorded", agentClient: p.agentClient ?? null, at: row.at.toISOString() };
}

/** The latest request recorded for a cart, or null. */
export async function loadAgentRequest(db: Db, shopId: string, cartId: string): Promise<AgentRequest | null> {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.shopId, shopId), eq(events.type, "cart.request"), eq(events.ref, cartId)))
    .orderBy(desc(events.id))
    .limit(1);
  if (!row) return null;
  return {
    items: (row.payload.items as RequestedItem[]) ?? [],
    source: "recorded",
    agentClient: (row.payload.agent as string | null) ?? null,
    at: row.at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Evidence

export interface EvidenceLine {
  name: string;
  variantId: string;
  quantity: number;
  unitPrice: string;
  attributes: Record<string, string>;
}

/** Everything the evidence document shows about one order. */
export interface EvidencePacket {
  shopName: string;
  orderId: string;
  disputeId?: string;
  disputeReason?: string | null;
  decision?: DisputeDecision;
  paypal: { orderId?: string | null; authorizationId?: string | null; captureId?: string | null; payerId?: string | null };
  totalCents: number;
  currency: string;
  lines: EvidenceLine[];
  agent: { clientIdentifier?: string | null };
  request?: AgentRequest | null;
  negotiation?: NegotiationSummary | null;
  /** Milestones, oldest first. */
  timeline: { label: string; at: string }[];
  tracking?: Tracking | null;
  shipTo?: string;
  generatedAt: string;
}

const REASON_LABEL: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Item not as described",
  UNAUTHORISED: "Unauthorised transaction",
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function attrText(attrs: Record<string, string> | { name: string; value: string }[] | undefined): string {
  const pairs = Array.isArray(attrs) ? attrs.map((a) => [a.name, a.value] as const) : Object.entries(attrs ?? {});
  return pairs.map(([k, v]) => `${k}: ${v}`).join(", ");
}

/** A one- or two-page PDF a dispute reviewer can read on its own. */
export function buildEvidencePdf(e: EvidencePacket): Uint8Array {
  const out: PdfLine[] = [];
  const heading = (text: string) => out.push({ text, size: 12, bold: true, gap: 12, rule: true });
  const row = (label: string, value: string | null | undefined) => {
    if (value) out.push({ text: `${label}: ${value}`, indent: 0, gap: 1 });
  };

  out.push({ text: `Dispute evidence — ${e.shopName}`, size: 18, bold: true });
  out.push({
    text: `Order ${e.orderId}${e.disputeId ? ` · PayPal dispute ${e.disputeId}` : ""}`,
    size: 11,
    gap: 4,
  });
  out.push({ text: `Prepared ${when(e.generatedAt)} from the shop's order records on Counter.`, size: 9, gap: 2 });

  if (e.decision || e.disputeReason) {
    heading("Summary");
    row("Claim", e.disputeReason ? (REASON_LABEL[e.disputeReason] ?? e.disputeReason) : undefined);
    if (e.decision) {
      row("Response", e.decision.action === "fight" ? "The shop contests this claim" : "The shop accepts this claim");
      row("Why", e.decision.reason);
      row("Evidence type", e.decision.evidenceType);
    }
  }

  heading("Order");
  row("Merchant order number", e.orderId);
  row("Order total", `${e.currency} ${fmt(e.totalCents)}`);
  row("PayPal order", e.paypal.orderId);
  row("PayPal authorization", e.paypal.authorizationId);
  row("PayPal capture", e.paypal.captureId);
  row("PayPal payer id", e.paypal.payerId ? `${e.paypal.payerId} (the buyer approved this payment in PayPal)` : undefined);
  row("Ship to", e.shipTo);

  heading("Items");
  for (const l of e.lines) {
    out.push({ text: `${l.quantity} x ${l.name} at ${e.currency} ${l.unitPrice} each`, gap: 2 });
    const attrs = attrText(l.attributes);
    out.push({ text: `variant ${l.variantId}${attrs ? ` · ${attrs}` : ""}`, size: 9, indent: 14 });
  }

  heading("Buying agent");
  row("Agent platform (Client_Identifier)", e.agent.clientIdentifier ?? "not recorded");
  if (e.request?.items.length) {
    out.push({
      text:
        e.request.source === "recorded"
          ? `What the agent asked for${e.request.at ? ` (${when(e.request.at)})` : ""}:`
          : "What the agent confirmed at checkout:",
      gap: 2,
    });
    for (const i of e.request.items) {
      const attrs = attrText(i.selected_attributes);
      out.push({ text: `${i.quantity} x ${i.variant_id}${attrs ? ` (${attrs})` : ""}`, size: 9, indent: 14 });
    }
  }

  if (e.negotiation && e.negotiation.turns.length) {
    heading("Price negotiation");
    row(
      "Outcome",
      [e.negotiation.outcome, e.negotiation.finalUnitCents != null ? `final unit price ${e.currency} ${fmt(e.negotiation.finalUnitCents)}` : null]
        .filter(Boolean)
        .join(", "),
    );
    for (const t of e.negotiation.turns) {
      out.push({ text: `${t.from}: ${t.text.replace(/\s+/g, " ").slice(0, 400)}`, size: 9, indent: 14, gap: 1 });
    }
  }

  if (e.timeline.length) {
    heading("Timeline");
    for (const t of e.timeline) out.push({ text: `${when(t.at)}   ${t.label}`, gap: 1 });
  }

  if (e.tracking?.trackingNumber) {
    heading("Shipment");
    row("Carrier", e.tracking.carrier);
    row("Tracking number", e.tracking.trackingNumber);
    row("Tracking link", e.tracking.url);
    row("Shipped", e.tracking.shippedAt ? when(e.tracking.shippedAt) : undefined);
  }

  return renderPdf(out, {
    title: `Dispute evidence ${e.orderId}`,
    createdAt: e.generatedAt,
    footer: `${e.shopName} · order ${e.orderId}${e.disputeId ? ` · dispute ${e.disputeId}` : ""}`,
  });
}

// ---------------------------------------------------------------------------
// Loading a case and answering PayPal

async function loadNegotiation(db: Db, shopId: string, cart: DisputeCart): Promise<NegotiationSummary | null> {
  const codes = (cart.cart.discounts?.applied ?? []).map((a) => a.code).filter((c): c is string => Boolean(c));
  const match = or(
    eq(negotiations.cartId, cart.id),
    ...codes.map((code) => sql`${negotiations.transcript} @> ${JSON.stringify([{ offerId: code }])}::jsonb`),
  );
  const [row] = await db
    .select()
    .from(negotiations)
    .where(and(eq(negotiations.shopId, shopId), match))
    .orderBy(desc(negotiations.createdAt))
    .limit(1);
  if (!row) return null;
  const turns = (row.transcript as Array<Record<string, unknown>>)
    .filter((t) => typeof t?.from === "string" && typeof t?.text === "string")
    .map((t) => ({ from: t.from as string, text: t.text as string }));
  return { outcome: row.outcome, finalUnitCents: row.finalUnitCents, turns };
}

async function timelineOf(db: Db, order: Order, cart: DisputeCart): Promise<{ label: string; at: string }[]> {
  const rows = await db
    .select({ type: events.type, ref: events.ref, at: events.at })
    .from(events)
    .where(
      and(
        eq(events.shopId, order.shopId),
        or(
          and(eq(events.ref, order.id), inArray(events.type, ["order.authorized", "order.captured", "order.shipped", "order.refunded"])),
          and(eq(events.ref, cart.id), eq(events.type, "paypal.CHECKOUT.ORDER.APPROVED")),
        ),
      ),
    )
    .orderBy(asc(events.id));
  const first = (type: string) => rows.find((r) => r.type === type)?.at.toISOString();
  const entries: Array<{ label: string; at: string | undefined }> = [
    { label: "Cart created by the buying agent", at: cart.createdAt?.toISOString() },
    { label: "Buyer approved the payment in PayPal", at: first("paypal.CHECKOUT.ORDER.APPROVED") },
    { label: "Payment authorized at checkout", at: first("order.authorized") ?? order.createdAt.toISOString() },
    { label: "Payment captured", at: first("order.captured") },
    { label: "Shipped", at: order.tracking?.shippedAt ?? first("order.shipped") },
    { label: "Refunded", at: first("order.refunded") },
  ];
  return entries
    .filter((e): e is { label: string; at: string } => Boolean(e.at))
    .sort((a, b) => a.at.localeCompare(b.at));
}

function shipToOf(cart: PayPalCart): string | undefined {
  const a = cart.shipping_address;
  if (!a) return undefined;
  const cityLine = [a.admin_area_2, [a.admin_area_1, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.address_line_1, a.address_line_2, cityLine, a.country_code].filter(Boolean).join(", ");
}

function linesOf(cart: PayPalCart): EvidenceLine[] {
  return (cart.items ?? [])
    .filter((i) => i.variant_id)
    .map((i) => ({
      name: i.name ?? i.variant_id!,
      variantId: i.variant_id!,
      quantity: i.quantity,
      unitPrice: i.price?.value ?? "0.00",
      attributes: Object.fromEntries((i.selected_attributes ?? []).map((a) => [a.name ?? "", a.value ?? ""])),
    }));
}

export interface DisputeResponse {
  disputeId: string;
  orderId: string;
  decision: DisputeDecision;
  alreadyResponded: boolean;
  /** Name of the evidence document sent to PayPal, when the shop fought. */
  evidenceFile?: string;
}

interface EvidenceEntry {
  at: string;
  action: DisputeDecision["action"];
  reason: string;
  evidence_type: EvidenceType | null;
  file?: string;
  notes?: string;
  /** How the answer reached PayPal: typed evidence, or notes and a document while PayPal reviews the case. */
  channel?: "evidence" | "supporting_info";
}

/**
 * Reads a dispute PayPal knows about but Counter has no record of yet (its
 * webhook is late or was missed) and records it. Tried in the platform's own
 * account first, then in each connected shop's.
 */
async function importDispute(db: Db, paypal: PayPal, disputeId: string): Promise<void> {
  const connected = await db.select({ m: shopTable.paypalMerchantId }).from(shopTable).where(isNotNull(shopTable.paypalMerchantId));
  const accounts: Array<string | undefined> = [undefined, ...new Set(connected.map((r) => r.m!))];
  for (const merchantId of accounts) {
    try {
      const live = await paypal.getDispute(disputeId, merchantId);
      await recordDispute(db, live.raw as Record<string, unknown>);
      return;
    } catch (err) {
      if (!(err instanceof PayPalApiError && (err.status === 404 || err.status === 403))) throw err;
    }
  }
}

function evidenceNotes(decision: DisputeDecision, e: EvidencePacket): string {
  const items = e.lines.map((l) => `${l.quantity} x ${l.variantId}${Object.keys(l.attributes).length ? ` (${attrText(l.attributes)})` : ""}`);
  const parts = [
    decision.reason,
    `Order ${e.orderId}: ${items.join("; ")}.`,
    e.agent.clientIdentifier ? `Bought through the agent platform ${e.agent.clientIdentifier}.` : "",
    e.paypal.payerId ? `The buyer approved the payment in PayPal as payer ${e.paypal.payerId}.` : "",
    "The attached document lists the order, the agent's request and the timeline.",
  ];
  return parts.filter(Boolean).join(" ").slice(0, 2000);
}

/**
 * Answers a recorded dispute: decides with `decideDispute`, then either sends
 * PayPal the evidence (with a PDF of the order) or accepts the claim, and
 * records the answer. A dispute is answered once; later calls return the
 * first answer.
 */
export async function respondToDispute(
  db: Db,
  paypal: PayPal,
  shops: ShopAccounts,
  disputeId: string,
  opts: { now?: () => Date } = {},
): Promise<DisputeResponse> {
  let [row] = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (!row) {
    await importDispute(db, paypal, disputeId);
    [row] = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  }
  if (!row) throw new PlatformError("not_found", `No dispute ${disputeId}`);
  if (!row.orderId) throw new PlatformError("conflict", `Dispute ${disputeId} is not matched to an order of ${row.shopId}`);
  if (row.decision === "fight" || row.decision === "accept") {
    const last = (row.evidence as EvidenceEntry[]).at(-1);
    return {
      disputeId,
      orderId: row.orderId,
      alreadyResponded: true,
      decision: { action: row.decision, reason: last?.reason ?? "", evidenceType: last?.evidence_type ?? null },
      ...(last?.file ? { evidenceFile: last.file } : {}),
    };
  }

  const order = await loadOrder(db, row.orderId);
  if (!order) throw new PlatformError("conflict", `Dispute ${disputeId} names order ${row.orderId}, which does not exist`);
  const [cartRow] = await db.select().from(carts).where(eq(carts.id, order.cartId)).limit(1);
  if (!cartRow) throw new PlatformError("conflict", `Order ${order.id} has no stored cart`);
  const cart: DisputeCart = { id: cartRow.id, cart: cartRow.cart as PayPalCart, agentClient: cartRow.agentClient, createdAt: cartRow.createdAt };

  const merchantId = await accountForOrder(order, shops);
  const live = await paypal.getDispute(disputeId, merchantId);
  // What PayPal takes right now, from the dispute's links. A dispute read without links keeps the classic calls.
  const rawLinks = (live.raw as { links?: unknown } | null)?.links;
  const linked = Array.isArray(rawLinks) && rawLinks.length > 0;
  const allows = (action: string) => !linked || live.allowedActions.includes(action);
  const reason = live.reason ?? row.reason;
  const request = await loadAgentRequest(db, order.shopId, cart.id);
  const negotiation = await loadNegotiation(db, order.shopId, cart);
  const decision = decideDispute(order, cart, { reason }, { request, negotiation, tracking: order.tracking, agentClient: cart.agentClient ?? null });
  const now = (opts.now ?? (() => new Date()))();

  const entry: EvidenceEntry = { at: now.toISOString(), action: decision.action, reason: decision.reason, evidence_type: decision.evidenceType };

  if (decision.action === "fight") {
    const shop = await getShop(db, order.shopId);
    const packet: EvidencePacket = {
      shopName: shop?.name ?? order.shopId,
      orderId: order.id,
      disputeId,
      disputeReason: reason,
      decision,
      paypal: { orderId: order.paypalOrderId, authorizationId: order.authorizationId, captureId: order.captureId, payerId: order.payerId },
      totalCents: order.totalCents,
      currency: cart.cart.totals?.total?.currency_code ?? "USD",
      lines: linesOf(cart.cart),
      agent: { clientIdentifier: cart.agentClient ?? null },
      request: request ?? requestFromCart(cart),
      negotiation,
      timeline: await timelineOf(db, order, cart),
      tracking: order.tracking,
      ...(shipToOf(cart.cart) ? { shipTo: shipToOf(cart.cart)! } : {}),
      generatedAt: now.toISOString(),
    };
    const file = `evidence-${order.id.replace(/[^A-Za-z0-9-_]/g, "-")}.pdf`;
    const notes = evidenceNotes(decision, packet);
    let evidenceInfo: { trackingInfo?: { carrierName: string; trackingNumber: string }[]; refundIds?: string[] } | undefined;
    if (decision.evidenceType === "PROOF_OF_FULFILLMENT" && order.tracking?.trackingNumber) {
      evidenceInfo = { trackingInfo: [{ carrierName: order.tracking.carrier, trackingNumber: order.tracking.trackingNumber }] };
    } else if (decision.evidenceType === "PROOF_OF_REFUND") {
      const refunds = await db
        .select({ payload: events.payload })
        .from(events)
        .where(and(eq(events.type, "order.refunded"), eq(events.ref, order.id)));
      const refundIds = refunds.map((r) => r.payload.refund_id).filter((id): id is string => typeof id === "string" && id.length > 0);
      if (refundIds.length) evidenceInfo = { refundIds };
    }
    const pdf = { name: file, bytes: buildEvidencePdf(packet), contentType: "application/pdf" };
    let channel: EvidenceEntry["channel"];
    if (allows("provide_evidence")) {
      await paypal.provideEvidence(disputeId, merchantId, {
        evidenceType: decision.evidenceType!,
        notes,
        ...(evidenceInfo ? { evidenceInfo } : {}),
        file: pdf,
      });
      channel = "evidence";
    } else if (live.allowedActions.includes("provide_supporting_info")) {
      await paypal.provideSupportingInfo(disputeId, merchantId, { notes, file: pdf });
      channel = "supporting_info";
    } else {
      throw new PlatformError("conflict", `PayPal is not taking a seller response on dispute ${disputeId} right now (${live.status ?? "status unknown"})`);
    }
    Object.assign(entry, { file, notes, channel });
    await saveAnswer(db, disputeId, "UNDER_REVIEW", reason, entry);
    await logEvent(db, order.shopId, "dispute.evidence_submitted", disputeId, {
      order_id: order.id,
      reason,
      evidence_type: decision.evidenceType,
      file,
      channel,
    });
    return { disputeId, orderId: order.id, decision, alreadyResponded: false, evidenceFile: file };
  }

  if (!allows("accept_claim")) {
    throw new PlatformError("conflict", `PayPal is not taking a seller response on dispute ${disputeId} right now (${live.status ?? "status unknown"})`);
  }
  const claimType = live.acceptClaimTypes.includes("REFUND") ? "REFUND" : undefined;
  const note = `${decision.reason} Order ${order.id}.`.slice(0, 2000);
  await paypal.acceptClaim(disputeId, merchantId, note, claimType ? { acceptClaimType: claimType } : {});
  Object.assign(entry, { notes: note });
  await saveAnswer(db, disputeId, "RESOLVED", reason, entry);
  const [refunded] = await db
    .update(orders)
    .set({ status: "refunded", updatedAt: sql`now()` })
    .where(and(eq(orders.id, order.id), inArray(orders.status, ["captured", "disputed"])))
    .returning({ id: orders.id });
  if (refunded) {
    await logEvent(db, order.shopId, "order.refunded", order.id, { by: "dispute", dispute_id: disputeId, amount_cents: order.totalCents });
  }
  await logEvent(db, order.shopId, "dispute.accepted", disputeId, { order_id: order.id, reason });
  return { disputeId, orderId: order.id, decision, alreadyResponded: false };
}

async function saveAnswer(db: Db, disputeId: string, status: string, reason: string | null | undefined, entry: EvidenceEntry): Promise<void> {
  await db
    .update(disputes)
    .set({
      decision: entry.action,
      status,
      reason: reason ?? null,
      evidence: sql`${disputes.evidence} || ${JSON.stringify([entry])}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(disputes.id, disputeId));
}
