import { carts, events, logEvent, orders, type Db, type Order, type OrderPatch, type OrderStatus, type Tracking } from "@counter/db";
import { PayPalApiError, type OrderItem, type PayPal } from "@counter/paypal";
import { fmt, type CartRecord, type OrderSink, type PayPalCart } from "@counter/store-sync";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { PlatformError } from "./errors";
import type { ShopAccounts } from "./payments";

/** 2% of the order total, taken at capture from shops paid to their own PayPal account. */
export const DEFAULT_PLATFORM_FEE_BPS = 200;

/** Void errors that mean the hold is already gone, so the order can be closed anyway. */
const ALREADY_VOIDED = ["PREVIOUSLY_VOIDED", "AUTHORIZATION_VOIDED", "AUTHORIZATION_ALREADY_VOIDED", "AUTHORIZATION_EXPIRED"];

export interface Shipment {
  carrier: string;
  trackingNumber: string;
}

export interface ShipResult {
  order: Order;
  captureId: string;
  platformFeeCents: number;
  /** True when the order had already shipped and nothing was sent to PayPal. */
  alreadyShipped: boolean;
}

export interface RefundResult {
  order: Order;
  refundId: string;
  amountCents: number;
  alreadyRefunded: boolean;
}

export interface FulfilmentOptions {
  /** Platform fee in basis points of the order total; default 200 (2%). */
  platformFeeBps?: number;
  now?: () => Date;
}

/** One stock movement per variant. */
export interface StockLine {
  variant_id: string;
  quantity: number;
}

/** The variants and quantities of a stored cart, one line per variant. */
export function stockLinesOf(cart: PayPalCart): StockLine[] {
  const qty = new Map<string, number>();
  for (const item of cart.items ?? []) {
    if (!item.variant_id || !(item.quantity > 0)) continue;
    qty.set(item.variant_id, (qty.get(item.variant_id) ?? 0) + item.quantity);
  }
  return [...qty].map(([variant_id, quantity]) => ({ variant_id, quantity }));
}

export async function loadOrder(db: Db, id: string): Promise<Order | null> {
  const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return row ?? null;
}

async function mustLoadOrder(db: Db, id: string): Promise<Order> {
  const order = await loadOrder(db, id);
  if (!order) throw new PlatformError("not_found", `No order ${id}`);
  return order;
}

/** Applies `patch` only if the order is still in one of the `from` states; null when another writer got there first. */
async function transition(db: Db, id: string, from: OrderStatus[], patch: OrderPatch): Promise<Order | null> {
  const [row] = await db
    .update(orders)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(orders.id, id), inArray(orders.status, from)))
    .returning();
  return row ?? null;
}

async function cartOf(db: Db, cartId: string): Promise<PayPalCart | null> {
  const [row] = await db.select({ cart: carts.cart }).from(carts).where(eq(carts.id, cartId)).limit(1);
  return (row?.cart as PayPalCart | undefined) ?? null;
}

function rows<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

/**
 * Takes an order's lines out of stock. Runs at most once per order: the
 * `order.stock_reserved` event is the claim, written in the same statement as
 * the decrement. Returns false when the order had already reserved its stock.
 */
export async function reserveStock(db: Db, shopId: string, orderId: string, lines: StockLine[]): Promise<boolean> {
  if (lines.length === 0) return false;
  const result = await db.execute(sql`
    with claim as (
      insert into events (shop_id, type, ref, payload)
      select ${shopId}::text, 'order.stock_reserved', ${orderId}::text, ${JSON.stringify({ lines })}::jsonb
      where not exists (
        select 1 from events where shop_id = ${shopId}::text and type = 'order.stock_reserved' and ref = ${orderId}::text
      )
      returning payload
    ),
    wanted as (
      select l.variant_id, sum(l.quantity)::int as quantity
      from claim, jsonb_to_recordset(claim.payload -> 'lines') as l(variant_id text, quantity int)
      group by l.variant_id
    ),
    taken as (
      update variants v set stock = v.stock - w.quantity
      from wanted w
      where v.shop_id = ${shopId}::text and v.variant_id = w.variant_id
      returning v.variant_id
    )
    select (select count(*) from claim)::int as claimed, (select count(*) from taken)::int as moved
  `);
  return (rows<{ claimed: number }>(result)[0]?.claimed ?? 0) > 0;
}

/**
 * Puts back the stock an order reserved, at most once, and only if it
 * reserved any. Returns true when stock moved.
 */
export async function restoreStock(db: Db, shopId: string, orderId: string, reason: string): Promise<boolean> {
  const result = await db.execute(sql`
    with reserved as (
      select payload -> 'lines' as lines from events
      where shop_id = ${shopId}::text and type = 'order.stock_reserved' and ref = ${orderId}::text
      order by id limit 1
    ),
    claim as (
      insert into events (shop_id, type, ref, payload)
      select ${shopId}::text, 'order.stock_restored', ${orderId}::text, jsonb_build_object('lines', reserved.lines, 'reason', ${reason}::text)
      from reserved
      where not exists (
        select 1 from events where shop_id = ${shopId}::text and type = 'order.stock_restored' and ref = ${orderId}::text
      )
      returning payload
    ),
    wanted as (
      select l.variant_id, sum(l.quantity)::int as quantity
      from claim, jsonb_to_recordset(claim.payload -> 'lines') as l(variant_id text, quantity int)
      group by l.variant_id
    ),
    put as (
      update variants v set stock = v.stock + w.quantity
      from wanted w
      where v.shop_id = ${shopId}::text and v.variant_id = w.variant_id
      returning v.variant_id
    )
    select (select count(*) from claim)::int as claimed, (select count(*) from put)::int as moved
  `);
  return (rows<{ claimed: number }>(result)[0]?.claimed ?? 0) > 0;
}

/**
 * Closes an authorized order whose hold is gone (voided by the merchant, or
 * expired at PayPal) and puts its stock back. Safe to call more than once.
 */
export async function markVoided(
  db: Db,
  orderId: string,
  reason: string,
  by: "merchant" | "paypal",
): Promise<{ order: Order; changed: boolean }> {
  const won = await transition(db, orderId, ["authorized"], { status: "voided" });
  if (!won) return { order: await mustLoadOrder(db, orderId), changed: false };
  const restocked = await restoreStock(db, won.shopId, won.id, reason);
  await logEvent(db, won.shopId, "order.voided", won.id, {
    reason,
    by,
    authorization_id: won.authorizationId,
    restocked,
  });
  return { order: won, changed: true };
}

/**
 * Wraps an order sink so every newly authorized order takes its items out of
 * stock. Checkout can be retried, so the decrement happens once per order.
 */
export class StockKeepingOrderSink implements OrderSink {
  constructor(
    private readonly db: Db,
    private readonly inner: OrderSink,
  ) {}

  async onCompleted(
    r: CartRecord,
    auth: { authorizationId: string; payerId: string },
  ): Promise<{ merchantOrderNumber: string; orderReviewPage: string }> {
    const out = await this.inner.onCompleted(r, auth);
    await reserveStock(this.db, r.shopId, out.merchantOrderNumber, stockLinesOf(r.cart));
    return out;
  }
}

function trackingItems(cart: PayPalCart | null): OrderItem[] | undefined {
  const items = (cart?.items ?? []).filter((i) => i.variant_id && i.quantity > 0);
  if (items.length === 0) return undefined;
  return items.map((i) => ({
    name: (i.name || i.variant_id!).slice(0, 127),
    quantity: i.quantity,
    unitAmount: i.price?.value ?? "0.00",
    sku: i.variant_id!,
    ...(i.item_url ? { url: i.item_url } : {}),
  }));
}

/**
 * What happens to an order after checkout. Checkout only authorizes the
 * buyer's payment; the money moves when the shop ships (capture, with the
 * platform fee for onboarded shops), or the hold is released when the shop
 * cancels. Every step is idempotent so the merchant can safely retry.
 */
export class Fulfilment {
  private readonly feeBps: number;
  private readonly now: () => Date;

  constructor(
    private readonly db: Db,
    private readonly paypal: PayPal,
    private readonly shops: ShopAccounts,
    opts: FulfilmentOptions = {},
  ) {
    this.feeBps = opts.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS;
    if (!Number.isInteger(this.feeBps) || this.feeBps < 0 || this.feeBps > 10_000) {
      throw new RangeError(`platformFeeBps must be a whole number from 0 to 10000, got ${this.feeBps}`);
    }
    this.now = opts.now ?? (() => new Date());
  }

  /** Captures the payment and attaches tracking to the PayPal order. */
  async ship(orderId: string, shipment: Shipment): Promise<ShipResult> {
    const carrier = shipment.carrier?.trim();
    const trackingNumber = shipment.trackingNumber?.trim();
    if (!carrier || !trackingNumber) throw new PlatformError("invalid_request", "carrier and trackingNumber are required");

    let order = await mustLoadOrder(this.db, orderId);
    if (order.captureId && order.tracking) return this.shipped(order, true);
    if (order.status === "authorized") order = await this.capture(order);
    else if (!(order.captureId && (order.status === "captured" || order.status === "disputed"))) {
      throw new PlatformError("conflict", `Order ${orderId} is ${order.status} and cannot ship`);
    }
    const captureId = order.captureId!;

    const merchantId = await this.shops.merchantIdFor(order.shopId);
    if (order.paypalOrderId) {
      const items = trackingItems(await cartOf(this.db, order.cartId));
      await this.paypal.addTracking(order.paypalOrderId, merchantId, {
        captureId,
        trackingNumber,
        carrier,
        ...(items ? { items } : {}),
      });
    }

    const tracking: Tracking = { carrier, trackingNumber, shippedAt: this.now().toISOString() };
    const [saved] = await this.db
      .update(orders)
      .set({ tracking, updatedAt: sql`now()` })
      .where(and(eq(orders.id, order.id), isNull(orders.tracking)))
      .returning();
    if (!saved) return this.shipped(await mustLoadOrder(this.db, order.id), true);
    await logEvent(this.db, saved.shopId, "order.shipped", saved.id, {
      carrier,
      tracking_number: trackingNumber,
      capture_id: captureId,
      paypal_order_id: saved.paypalOrderId,
    });
    return this.shipped(saved, false);
  }

  private shipped(order: Order, alreadyShipped: boolean): ShipResult {
    return { order, captureId: order.captureId!, platformFeeCents: order.platformFeeCents ?? 0, alreadyShipped };
  }

  private async capture(order: Order): Promise<Order> {
    if (!order.authorizationId) throw new PlatformError("conflict", `Order ${order.id} has no PayPal authorization to capture`);
    const merchantId = await this.shops.merchantIdFor(order.shopId);
    const feeCents = merchantId ? Math.round((order.totalCents * this.feeBps) / 10_000) : 0;
    const { captureId, status } = await this.paypal.captureAuthorization(order.authorizationId, merchantId, {
      finalCapture: true,
      ...(feeCents > 0 ? { platformFee: { currency: "USD", value: fmt(feeCents) } } : {}),
      requestId: `${order.id}-capture`,
    });
    if (status === "DECLINED" || status === "FAILED") {
      await logEvent(this.db, order.shopId, "order.capture_declined", order.id, { capture_id: captureId, status });
      throw new PlatformError("conflict", `PayPal declined the capture of order ${order.id} (${status})`);
    }

    const won = await transition(this.db, order.id, ["authorized"], { status: "captured", captureId, platformFeeCents: feeCents });
    if (!won) {
      const current = await mustLoadOrder(this.db, order.id);
      if (current.captureId) return current;
      throw new PlatformError("conflict", `Order ${order.id} changed to ${current.status} while it was being captured`);
    }
    await logEvent(this.db, won.shopId, "order.captured", won.id, {
      capture_id: captureId,
      capture_status: status,
      amount_cents: won.totalCents,
      platform_fee_cents: feeCents,
      merchant_id: merchantId ?? null,
    });
    return won;
  }

  /** Releases the buyer's hold and puts the items back in stock. */
  async cancel(orderId: string, reason: string): Promise<Order> {
    const order = await mustLoadOrder(this.db, orderId);
    if (order.status === "voided") return order;
    if (order.status !== "authorized") {
      throw new PlatformError("conflict", `Order ${orderId} is ${order.status}; only orders that have not shipped can be cancelled (refund it instead)`);
    }
    if (order.authorizationId) {
      const merchantId = await this.shops.merchantIdFor(order.shopId);
      try {
        await this.paypal.voidAuthorization(order.authorizationId, merchantId, `${order.id}-void`);
      } catch (err) {
        if (!(err instanceof PayPalApiError && ALREADY_VOIDED.some((i) => err.has(i)))) throw err;
      }
    }
    return (await markVoided(this.db, order.id, reason.trim() || "cancelled by the shop", "merchant")).order;
  }

  /** Refunds a captured order, in full or `amountCents` of it. */
  async refund(orderId: string, amountCents?: number): Promise<RefundResult> {
    const order = await mustLoadOrder(this.db, orderId);
    if (order.status === "refunded") {
      const [prev] = await this.db
        .select()
        .from(events)
        .where(and(eq(events.type, "order.refunded"), eq(events.ref, order.id)))
        .orderBy(desc(events.id))
        .limit(1);
      return {
        order,
        refundId: String(prev?.payload.refund_id ?? ""),
        amountCents: Number(prev?.payload.amount_cents ?? order.totalCents),
        alreadyRefunded: true,
      };
    }
    if (!order.captureId || !(order.status === "captured" || order.status === "disputed")) {
      throw new PlatformError("conflict", `Order ${orderId} is ${order.status}; only captured orders can be refunded`);
    }
    if (amountCents !== undefined && (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > order.totalCents)) {
      throw new PlatformError("invalid_request", `amountCents must be a whole number from 1 to ${order.totalCents}`);
    }
    const amount = amountCents ?? order.totalCents;
    const merchantId = await this.shops.merchantIdFor(order.shopId);
    const { refundId, status } = await this.paypal.refundCapture(order.captureId, merchantId, {
      ...(amount < order.totalCents ? { amount: { currency: "USD", value: fmt(amount) } } : {}),
      requestId: `${order.id}-refund`,
    });
    const won = await transition(this.db, order.id, ["captured", "disputed"], { status: "refunded" });
    const final = won ?? (await mustLoadOrder(this.db, order.id));
    if (won) {
      await logEvent(this.db, won.shopId, "order.refunded", won.id, {
        refund_id: refundId,
        refund_status: status,
        amount_cents: amount,
        capture_id: order.captureId,
      });
    }
    return { order: final, refundId, amountCents: amount, alreadyRefunded: !won };
  }
}
