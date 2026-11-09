import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../client";
import { shops, variants, type NewShop, type NewVariant, type ShopPolicy } from "../schema";
import { publicBaseUrl, storefrontUrl } from "../urls";
import catalogJson from "./catalog.json" with { type: "json" };

export interface CatalogFileVariant {
  variant_id: string;
  attributes: Record<string, string>;
  /** Decimal strings, e.g. "34.00". */
  price: string;
  cost: string;
  floor: string;
  stock: number;
  weight_g: number;
  active: boolean;
  purchasable: boolean;
  lead_time_days: number;
  flags: string[];
}

export interface CatalogFileProduct {
  parent_id: string;
  name: string;
  category: string;
  description: string;
  attributes_order?: string[];
  variants: CatalogFileVariant[];
}

export interface CatalogFileShop {
  slug: string;
  name: string;
  tagline: string;
  owner: string;
  city: string;
  state: string;
  about: string;
  policy: ShopPolicy;
  products: CatalogFileProduct[];
}

export interface CatalogFile {
  shops: CatalogFileShop[];
}

export const demoCatalog = catalogJson as CatalogFile;

/** Merchant order number prefixes for the demo shops. */
export const ORDER_PREFIXES: Readonly<Record<string, string>> = {
  "juniper-clay": "JC",
  "northpaw-roasters": "NP",
  "loop-and-lantern": "LL",
};

/** Initials of the slug's words, skipping "and": "blue-fern-studio" -> "BFS". */
export function orderPrefixFor(slug: string): string {
  return (
    ORDER_PREFIXES[slug] ??
    slug
      .split("-")
      .filter((w) => w && w !== "and")
      .map((w) => w[0]!.toUpperCase())
      .join("")
  );
}

const DECIMAL = /^\d+\.\d{2}$/;

function cents(v: string): number {
  if (!DECIMAL.test(v)) throw new TypeError(`Expected an amount like "34.00", got ${JSON.stringify(v)}`);
  const [whole, frac] = v.split(".");
  return Number(whole) * 100 + Number(frac);
}

/** "Speckled mug — sage, 12 oz": product name plus attribute values in display order. */
export function variantName(p: CatalogFileProduct, v: CatalogFileVariant): string {
  const order = p.attributes_order?.length ? p.attributes_order : Object.keys(v.attributes);
  const values = order.map((k) => v.attributes[k]).filter((x): x is string => Boolean(x));
  return values.length ? `${p.name} — ${values.join(", ")}` : p.name;
}

/** `ON CONFLICT ... DO UPDATE SET` that takes the listed columns from the incoming row. */
function fromExcluded<T extends PgTable>(table: T, keys: readonly (keyof T["$inferInsert"] & string)[]): Record<string, SQL> {
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  return Object.fromEntries(keys.map((k) => [k, sql.raw(`excluded."${columns[k]!.name}"`)]));
}

export interface SeedOptions {
  catalog?: CatalogFile;
  /** Origin the storefront is served from; defaults to `PUBLIC_BASE_URL`. */
  publicBaseUrl?: string;
}

/**
 * Upserts the catalog into `shops` and `variants`. Safe to run repeatedly:
 * catalog fields (prices, stock, copy) are reset to the file, while state
 * owned elsewhere (PayPal onboarding, order numbering, market data) is kept.
 */
export async function seedCatalog(db: Db, opts: SeedOptions = {}): Promise<{ shops: number; variants: number }> {
  const file = opts.catalog ?? demoCatalog;
  const base = opts.publicBaseUrl ?? publicBaseUrl();

  const shopRows: NewShop[] = file.shops.map((s) => ({
    id: s.slug,
    slug: s.slug,
    name: s.name,
    owner: s.owner,
    city: s.city,
    state: s.state,
    tagline: s.tagline,
    about: s.about,
    policy: s.policy,
    orderPrefix: orderPrefixFor(s.slug),
  }));

  const variantRows: NewVariant[] = file.shops.flatMap((s) => {
    let position = 0;
    return s.products.flatMap((p) =>
      p.variants.map((v) => ({
        id: `${s.slug}:${v.variant_id}`,
        shopId: s.slug,
        variantId: v.variant_id,
        parentId: p.parent_id,
        productName: p.name,
        name: variantName(p, v),
        category: p.category,
        description: p.description,
        url: storefrontUrl(base, s.slug, p.parent_id, v.variant_id),
        priceCents: cents(v.price),
        costCents: cents(v.cost),
        floorCents: cents(v.floor),
        stock: v.stock,
        attributes: v.attributes,
        flags: v.flags,
        purchasable: v.purchasable,
        leadTimeDays: v.lead_time_days,
        weightG: v.weight_g,
        active: v.active,
        position: position++,
      })),
    );
  });

  if (shopRows.length) {
    await db
      .insert(shops)
      .values(shopRows)
      .onConflictDoUpdate({
        target: shops.id,
        set: fromExcluded(shops, ["slug", "name", "owner", "city", "state", "tagline", "about", "policy", "orderPrefix"]),
      });
  }

  if (variantRows.length) {
    const updatable = [
      "parentId",
      "productName",
      "name",
      "category",
      "description",
      "url",
      "priceCents",
      "costCents",
      "floorCents",
      "stock",
      "attributes",
      "flags",
      "purchasable",
      "leadTimeDays",
      "weightG",
      "active",
      "position",
    ] as const;
    await db
      .insert(variants)
      .values(variantRows)
      .onConflictDoUpdate({
        target: variants.id,
        set: fromExcluded(variants, updatable),
      });
  }

  return { shops: shopRows.length, variants: variantRows.length };
}
