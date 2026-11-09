import type { CatalogPort, CatalogVariant } from "@counter/store-sync";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { shops, variants, type Shop, type Variant } from "./schema";

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
