import type { CartRecord, CartRepo, CatalogPort, CatalogVariant, OrderSink, PayPalCart } from "@counter/store-sync";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  carts,
  events,
  orders,
  shops,
  variants,
  type CartRow,
  type EventRow,
  type NewOrder,
  type Order,
  type Shop,
  type Variant,
} from "./schema";
import { orderReviewUrl, publicBaseUrl } from "./urls";

// Shop ids are slugs: the `shopId` Store Sync hands to every port is the shop's
// slug, and every `shop_id` column stores it.

// ---------------------------------------------------------------------------
// Catalog

/**
 * Store Sync's view of the catalog. A variant can go in a cart only if it is
 * active and sold on its own (`purchasable`); subscription-only variants read
 * as inactive. Lead time comes from the variant, handling days from the shop.
 */
export class DbCatalog implements CatalogPort {
  constructor(private readonly db: Db) {}

  async getVariant(shopId: string, variantId: string): Promise<CatalogVariant | null> {
    const [row] = await this.db
      .select({
        variantId: variants.variantId,
        parentId: variants.parentId,
        name: variants.name,
        url: variants.url,
        priceCents: variants.priceCents,
        stock: variants.stock,
        attributes: variants.attributes,
        active: variants.active,
        purchasable: variants.purchasable,
        leadTimeDays: variants.leadTimeDays,
        policy: shops.policy,
      })
      .from(variants)
      .innerJoin(shops, eq(shops.id, variants.shopId))
      .where(and(eq(variants.shopId, shopId), eq(variants.variantId, variantId)))
      .limit(1);
    if (!row) return null;
    const { purchasable, active, policy, ...rest } = row;
    const handlingDays = policy.handling_days;
    return {
      ...rest,
      attributes: { ...rest.attributes },
      active: active && purchasable,
      ...(Number.isInteger(handlingDays) ? { handlingDays } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Carts

/** A cart record as read from the database, carrying the row version it was read at. */
export type StoredCartRecord = CartRecord & { version: number };

/** Another request wrote the cart after this one read it. */
export class ConcurrentUpdateError extends Error {
  override readonly name = "ConcurrentUpdateError";
  readonly shopId: string;
  readonly cartId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(shopId: string, cartId: string, expectedVersion: number, actualVersion: number) {
    super(`Cart ${cartId} changed while this request was working on it (read version ${expectedVersion}, now ${actualVersion})`);
    this.shopId = shopId;
    this.cartId = cartId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

function toCartRecord(row: CartRow): StoredCartRecord {
  return {
    id: row.id,
    shopId: row.shopId,
    status: row.status,
    cart: row.cart as PayPalCart,
    ...(row.paypalOrderId != null ? { paypalOrderId: row.paypalOrderId } : {}),
    ...(row.lastTotalCents != null ? { lastTotalCents: row.lastTotalCents } : {}),
    ...(row.completedResponse != null ? { completedResponse: row.completedResponse as object } : {}),
    ...(row.agentClient != null ? { agentClient: row.agentClient } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function cartFields(r: CartRecord) {
  return {
    status: r.status,
    cart: r.cart,
    paypalOrderId: r.paypalOrderId ?? null,
    lastTotalCents: r.lastTotalCents ?? null,
    completedResponse: r.completedResponse ?? null,
    agentClient: r.agentClient ?? null,
    updatedAt: r.updatedAt,
  };
}

/**
 * Carts with optimistic concurrency. Store Sync serializes requests for one
 * cart inside a process; across serverless instances, each write names the
 * version it read and fails with `ConcurrentUpdateError` if another write got
 * there first. Writes stamp the stored version back onto the record passed
 * in, so a handler can write the same record (or copies of it) again.
 */
export class DbCartRepo implements CartRepo {
  constructor(private readonly db: Db) {}

  async insert(r: CartRecord): Promise<void> {
    await this.db.insert(carts).values({ id: r.id, shopId: r.shopId, createdAt: r.createdAt, version: 0, ...cartFields(r) });
    (r as StoredCartRecord).version = 0;
  }

  async get(shopId: string, id: string): Promise<StoredCartRecord | null> {
    const [row] = await this.db
      .select()
      .from(carts)
      .where(and(eq(carts.shopId, shopId), eq(carts.id, id)))
      .limit(1);
    return row ? toCartRecord(row) : null;
  }

  async update(r: CartRecord): Promise<void> {
    const expected = (r as Partial<StoredCartRecord>).version;
    if (typeof expected !== "number") {
      throw new TypeError(`Cart ${r.id} has no stored version; read it from the repo before updating it`);
    }
    const [written] = await this.db
      .update(carts)
      .set({ ...cartFields(r), version: sql`${carts.version} + 1` })
      .where(and(eq(carts.shopId, r.shopId), eq(carts.id, r.id), eq(carts.version, expected)))
      .returning({ version: carts.version });
    if (written) {
      (r as StoredCartRecord).version = written.version;
      return;
    }
    const current = await this.get(r.shopId, r.id);
    if (!current) throw new Error(`Cart ${r.id} does not exist`);
    throw new ConcurrentUpdateError(r.shopId, r.id, expected, current.version);
  }
}

// ---------------------------------------------------------------------------
// Orders

function totalCentsOf(r: CartRecord): number {
  if (r.lastTotalCents != null) return r.lastTotalCents;
  const value = r.cart.totals?.total?.value;
  if (!value || !/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`Cart ${r.id} has no total`);
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/**
 * Books authorized carts as merchant orders numbered `<prefix>-<n>` per shop
 * (JC-10001, JC-10002, ...). Idempotent per cart: completing the same cart
 * again, even concurrently, returns the order booked the first time.
 */
export class DbOrderSink implements OrderSink {
  private readonly db: Db;
  private readonly baseUrl: string;

  constructor(db: Db, opts: { publicBaseUrl?: string } = {}) {
    this.db = db;
    this.baseUrl = opts.publicBaseUrl ?? publicBaseUrl();
  }

  async onCompleted(
    r: CartRecord,
    auth: { authorizationId: string; payerId: string; paidTo?: string },
  ): Promise<{ merchantOrderNumber: string; orderReviewPage: string }> {
    const totalCents = totalCentsOf(r);
    const payload = {
      cartId: r.id,
      paypalOrderId: r.paypalOrderId ?? null,
      authorizationId: auth.authorizationId,
      payerId: auth.payerId,
      totalCents,
      agentClient: r.agentClient ?? null,
    };
    // One statement, so the number, the order and its event land together or
    // not at all. A cart that already has an order takes no new number.
    const result = (await this.db.execute(sql`
      with existing as (
        select id from orders where cart_id = ${r.id}::text
      ),
      numbered as (
        update shops set order_seq = order_seq + 1
        where id = ${r.shopId}::text and not exists (select 1 from existing)
        returning order_prefix || '-' || order_seq as id
      ),
      booked as (
        insert into orders (id, shop_id, cart_id, paypal_order_id, authorization_id, payer_id, paid_to, status, total_cents)
        select id, ${r.shopId}::text, ${r.id}::text, ${r.paypalOrderId ?? null}::text, ${auth.authorizationId}::text,
               ${auth.payerId}::text, ${auth.paidTo ?? null}::text, 'authorized', ${totalCents}::integer
        from numbered
        on conflict (cart_id) do nothing
        returning id
      ),
      logged as (
        insert into events (shop_id, type, ref, payload)
        select ${r.shopId}::text, 'order.authorized', id, ${JSON.stringify(payload)}::jsonb from booked
      )
      select id from booked
      union all
      select id from existing
    `)) as unknown as { rows: Array<{ id: string }> };

    let id = result.rows[0]?.id;
    if (!id) {
      // Either the shop is unknown, or a concurrent completion of this cart booked it first.
      const booked = await getOrderByCart(this.db, r.id);
      if (!booked) throw new Error(`Cannot book cart ${r.id}: shop ${r.shopId} does not exist`);
      id = booked.id;
    }
    return { merchantOrderNumber: id, orderReviewPage: orderReviewUrl(this.baseUrl, r.shopId, id) };
  }
}

export async function getOrderByCart(db: Db, cartId: string): Promise<Order | null> {
  const [row] = await db.select().from(orders).where(eq(orders.cartId, cartId)).limit(1);
  return row ?? null;
}

export type OrderPatch = Partial<
  Pick<
    NewOrder,
    "status" | "paypalOrderId" | "authorizationId" | "captureId" | "payerId" | "paidTo" | "totalCents" | "platformFeeCents" | "tracking"
  >
>;

/** Applies a patch to an order and stamps `updated_at`; null if there is no such order. */
export async function updateOrder(db: Db, id: string, patch: OrderPatch): Promise<Order | null> {
  const [row] = await db
    .update(orders)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(orders.id, id))
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Events

export async function logEvent(
  db: Db,
  shopId: string,
  type: string,
  ref: string | null,
  payload: Record<string, unknown> = {},
): Promise<EventRow> {
  const [row] = await db.insert(events).values({ shopId, type, ref, payload }).returning();
  return row!;
}

export interface ListEventsOptions {
  /** Only events after this id (exclusive), oldest first: pass the last id seen to page forward. */
  sinceId?: number;
  /** 1 to 500; default 50. */
  limit?: number;
}

/**
 * A shop's events in the order they happened. Without `sinceId`, the latest
 * `limit` events; with it, the next `limit` events after that id.
 */
export async function listEvents(db: Db, shopId: string, opts: ListEventsOptions = {}): Promise<EventRow[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 500);
  if (opts.sinceId != null) {
    return db
      .select()
      .from(events)
      .where(and(eq(events.shopId, shopId), gt(events.id, opts.sinceId)))
      .orderBy(asc(events.id))
      .limit(limit);
  }
  const latest = await db.select().from(events).where(eq(events.shopId, shopId)).orderBy(desc(events.id)).limit(limit);
  return latest.reverse();
}

// ---------------------------------------------------------------------------
// Shop queries

export async function getShop(db: Db, slug: string): Promise<Shop | null> {
  const [row] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
  return row ?? null;
}

export async function listShops(db: Db): Promise<Shop[]> {
  return db.select().from(shops).orderBy(asc(shops.name));
}

/** A shop's variants in catalog order. */
export async function listVariants(db: Db, slug: string): Promise<Variant[]> {
  return db
    .select()
    .from(variants)
    .where(eq(variants.shopId, slug))
    .orderBy(asc(variants.position), asc(variants.variantId));
}
