import type { CartRecord, CartRepo, CatalogPort, CatalogVariant, PayPalCart } from "@counter/store-sync";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { carts, shops, variants, type CartRow, type Shop, type Variant } from "./schema";

// Shop ids are slugs: the `shopId` Store Sync hands to every port is the shop's
// slug, and every `shop_id` column stores it.

// ---------------------------------------------------------------------------
// Catalog

/** Store Sync's view of the catalog: a variant can go in a cart only if it is active and sold on its own. */
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
      })
      .from(variants)
      .where(and(eq(variants.shopId, shopId), eq(variants.variantId, variantId)))
      .limit(1);
    if (!row) return null;
    const { purchasable, active, ...rest } = row;
    return { ...rest, attributes: { ...rest.attributes }, active: active && purchasable };
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
