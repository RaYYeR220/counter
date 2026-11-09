import { SHIPPING_COUNTRIES, fmt, quoteShipping, toCents, type ShippingOptionId } from "@counter/store-sync";

// Discovery is not part of Store Sync: on PayPal's platform, agents search an
// ingested catalog feed. Counter serves the same role from its own data.

export interface ShopSummary {
  /** Shop slug; pass it as `shop` to the other tools. */
  shop: string;
  name: string;
  tagline?: string;
  about?: string;
  /** City and state the shop ships from, e.g. "Portland, OR". */
  location?: string;
  ships_to: string[];
  returns_days?: number;
  categories: string[];
  product_count: number;
}

export interface ProductHit {
  shop: string;
  shop_name: string;
  parent_id: string;
  variant_id: string;
  /** Product name plus the variant's attribute values. */
  name: string;
  category?: string;
  attributes: Record<string, string>;
  /** Unit price, two decimals. */
  price: string;
  currency: "USD";
  stock: number;
  in_stock: boolean;
  /** False when the variant cannot be bought on its own (inactive, subscription only, ...). */
  purchasable: boolean;
  flags: string[];
  lead_time_days: number;
  availability: string;
  /** Relevance to the query; higher is better. */
  score: number;
}

export interface DeliveryEstimate {
  id: ShippingOptionId;
  name: string;
  price: string;
  /** YYYY-MM-DD, for a US address. */
  estimated_delivery: string;
}

export interface VariantDetail {
  variant_id: string;
  name: string;
  attributes: Record<string, string>;
  price: string;
  currency: "USD";
  stock: number;
  in_stock: boolean;
  purchasable: boolean;
  flags: string[];
  lead_time_days: number;
  availability: string;
  /** Shipping options for one unit to a US address, if ordered now. */
  delivery: DeliveryEstimate[];
}

export interface ProductDetail {
  shop: string;
  shop_name: string;
  parent_id: string;
  name: string;
  category?: string;
  description?: string;
  attributes_order: string[];
  returns_days?: number;
  ships_to: string[];
  variants: VariantDetail[];
}

export interface SearchQuery {
  /** Restrict to one shop (slug). */
  shop?: string;
  /** Free text. Empty browses in catalog order. */
  query: string;
  /** Default 10, at most 50. */
  limit?: number;
}

/** What the agent tools need for discovery. */
export interface ShopDirectory {
  listShops(): Promise<ShopSummary[]>;
  search(q: SearchQuery): Promise<ProductHit[]>;
  getProduct(shop: string, parentId: string): Promise<ProductDetail | null>;
}

// ---------------------------------------------------------------------------
// Catalog feed (the shape of the demo catalog seed)

export interface FeedVariant {
  variant_id: string;
  attributes: Record<string, string>;
  /** Decimal string, e.g. "34.00". */
  price: string;
  stock: number;
  active?: boolean;
  purchasable?: boolean;
  lead_time_days?: number;
  flags?: string[];
}

export interface FeedProduct {
  parent_id: string;
  name: string;
  category?: string;
  description?: string;
  attributes_order?: string[];
  variants: FeedVariant[];
}

export interface FeedShop {
  slug: string;
  name: string;
  tagline?: string;
  about?: string;
  city?: string;
  state?: string;
  policy?: { returns_days?: number; ships_from_state?: string };
  products: FeedProduct[];
}

export interface CatalogFeed {
  shops: FeedShop[];
}

// ---------------------------------------------------------------------------
// Text matching

const STOPWORDS = new Set(
  "a an and any are as at be buy by can do find for from get have i in is it looking me my need of on or please show some that the this to want with you".split(
    " ",
  ),
);

/** Query words that should also match these catalog words. */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  green: ["sage"],
  olive: ["sage"],
  mint: ["sage"],
  blue: ["ink", "harbor"],
  navy: ["ink"],
  black: ["ink"],
  white: ["oat"],
  cream: ["oat"],
  ivory: ["oat"],
  beige: ["oat"],
  red: ["rust"],
  orange: ["rust", "ember"],
  terracotta: ["rust"],
  teal: ["harbor"],
  grey: ["gray", "fog"],
  gray: ["grey", "fog"],
  yellow: ["marigold"],
  gold: ["marigold"],
  mustard: ["marigold"],
  purple: ["blackberry"],
  plum: ["blackberry"],
  decaffeinated: ["decaf"],
  cup: ["mug"],
  dish: ["plate", "bowl"],
  coffee: ["roast", "bean", "espresso"],
  ground: ["drip", "espresso", "press"],
  sock: ["fingering"],
  wool: ["merino"],
  ounce: ["oz"],
  kilo: ["kg"],
  kilogram: ["kg"],
  gram: ["g"],
};

function stem(t: string): string {
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/** Lower-cased, accent-free word stems. "12oz" reads as "12 oz"; "pour-over" also yields "pourover". */
export function tokenize(text: string): string[] {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]s\b/g, "")
    .replace(/(\d)([a-z])/g, "$1 $2");
  const out: string[] = [];
  for (const m of s.matchAll(/[a-z]+(?:-[a-z]+)+/g)) out.push(stem(m[0].replace(/-/g, "")));
  for (const w of s.split(/[^a-z0-9]+/)) if (w) out.push(stem(w));
  return out;
}

interface Doc {
  shop: FeedShop;
  product: FeedProduct;
  variant: FeedVariant;
  order: number;
  fields: Array<{ weight: number; tokens: Set<string> }>;
  flagTokens: Set<string>;
}

function words(...parts: Array<string | undefined>): Set<string> {
  return new Set(parts.flatMap((p) => (p ? tokenize(p) : [])));
}

function flagWords(flags: string[]): Set<string> {
  return words(...flags.map((f) => f.replace(/_/g, " ")));
}

function bestField(doc: Doc, group: string[]): number {
  let best = 0;
  for (const f of doc.fields) {
    if (f.weight > best && group.some((t) => f.tokens.has(t))) best = f.weight;
  }
  return best;
}

/**
 * Sum over query words of (weight of the best field it matches) x (how rare
 * the word is in the catalog), so distinguishing words such as "decaf" count
 * for more than common ones such as "bean".
 */
function scoreDoc(
  doc: Doc,
  groups: string[][],
  rarity: number[],
  queryWords: Set<string>,
): { score: number; matched: number } {
  let score = 0;
  let matched = 0;
  groups.forEach((group, i) => {
    const best = bestField(doc, group);
    if (best > 0) matched += 1;
    score += best * rarity[i]!;
  });
  // A flag the buyer did not ask for (seconds, decaf, made to order...) makes it a different product.
  for (const flag of doc.variant.flags ?? []) {
    const fw = flagWords([flag]);
    if (![...fw].some((t) => queryWords.has(t))) score -= 0.5;
  }
  return { score, matched };
}

// ---------------------------------------------------------------------------

function variantName(p: FeedProduct, v: FeedVariant): string {
  const order = p.attributes_order ?? Object.keys(v.attributes);
  const values = order.map((k) => v.attributes[k]).filter(Boolean);
  for (const [k, val] of Object.entries(v.attributes)) if (!order.includes(k)) values.push(val);
  return values.length ? `${p.name} (${values.join(", ")})` : p.name;
}

function isPurchasable(v: FeedVariant): boolean {
  return (v.active ?? true) && (v.purchasable ?? true);
}

function availability(v: FeedVariant): string {
  const flags = v.flags ?? [];
  if (!isPurchasable(v)) {
    return flags.includes("subscription_only") ? "not sold on its own (subscription only)" : "not available to buy";
  }
  if (v.stock <= 0) return "out of stock";
  const lead = v.lead_time_days ?? 0;
  if (lead > 0) return `made to order: ships in about ${lead} days`;
  return `in stock (${v.stock} left)`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export interface JsonShopDirectoryOptions {
  now?: () => Date;
}

/** A directory over an in-memory catalog feed. */
export class JsonShopDirectory implements ShopDirectory {
  private readonly docs: Doc[] = [];
  private readonly now: () => Date;

  constructor(
    private readonly feed: CatalogFeed,
    opts: JsonShopDirectoryOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    let order = 0;
    for (const shop of feed.shops) {
      const shopWords = words(shop.name, shop.slug.replace(/-/g, " "));
      for (const product of shop.products) {
        const nameWords = words(product.name);
        const categoryWords = words(product.category);
        const descWords = words(product.description);
        for (const variant of product.variants) {
          const flags = variant.flags ?? [];
          this.docs.push({
            shop,
            product,
            variant,
            order: order++,
            flagTokens: flagWords(flags),
            fields: [
              { weight: 3, tokens: words(...Object.values(variant.attributes)) },
              { weight: 3, tokens: nameWords },
              { weight: 2, tokens: flagWords(flags) },
              { weight: 2, tokens: categoryWords },
              { weight: 1, tokens: words(...Object.keys(variant.attributes).map((k) => k.replace(/_/g, " "))) },
              { weight: 1, tokens: descWords },
              { weight: 1, tokens: shopWords },
            ],
          });
        }
      }
    }
  }

  async listShops(): Promise<ShopSummary[]> {
    return this.feed.shops.map((s) => ({
      shop: s.slug,
      name: s.name,
      ...(s.tagline ? { tagline: s.tagline } : {}),
      ...(s.about ? { about: s.about } : {}),
      ...(s.city || s.state ? { location: [s.city, s.city?.includes(",") ? undefined : s.state].filter(Boolean).join(", ") } : {}),
      ships_to: [...SHIPPING_COUNTRIES],
      ...(s.policy?.returns_days !== undefined ? { returns_days: s.policy.returns_days } : {}),
      categories: [...new Set(s.products.map((p) => p.category).filter((c): c is string => !!c))],
      product_count: s.products.length,
    }));
  }

  async search(q: SearchQuery): Promise<ProductHit[]> {
    const limit = Math.min(Math.max(Math.floor(q.limit ?? 10), 1), 50);
    const terms = [...new Set(tokenize(q.query).filter((t) => !STOPWORDS.has(t)))];
    const groups = terms.map((t) => [t, ...(SYNONYMS[t] ?? []).map(stem)]);
    const queryWords = new Set(groups.flat());
    const n = this.docs.length;
    const rarity = groups.map((g) => {
      const df = this.docs.filter((d) => bestField(d, g) > 0).length;
      return Math.log(1 + n / Math.max(df, 1));
    });
    const pool = q.shop ? this.docs.filter((d) => d.shop.slug === q.shop) : this.docs;

    const scored = pool
      .map((doc) => ({ doc, ...(groups.length ? scoreDoc(doc, groups, rarity, queryWords) : { score: 0, matched: 1 }) }))
      .filter((s) => s.matched > 0);
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.doc.variant.stock > 0) - Number(a.doc.variant.stock > 0) ||
        Number(isPurchasable(b.doc.variant)) - Number(isPurchasable(a.doc.variant)) ||
        a.doc.order - b.doc.order,
    );
    return scored.slice(0, limit).map(({ doc, score }) => this.hit(doc, score));
  }

  async getProduct(shopSlug: string, parentId: string): Promise<ProductDetail | null> {
    const shop = this.feed.shops.find((s) => s.slug === shopSlug);
    const want = parentId.trim().toUpperCase();
    const product = shop?.products.find((p) => p.parent_id.toUpperCase() === want);
    if (!shop || !product) return null;
    return {
      shop: shop.slug,
      shop_name: shop.name,
      parent_id: product.parent_id,
      name: product.name,
      ...(product.category ? { category: product.category } : {}),
      ...(product.description ? { description: product.description } : {}),
      attributes_order: product.attributes_order ?? Object.keys(product.variants[0]?.attributes ?? {}),
      ...(shop.policy?.returns_days !== undefined ? { returns_days: shop.policy.returns_days } : {}),
      ships_to: [...SHIPPING_COUNTRIES],
      variants: product.variants.map((v) => ({
        variant_id: v.variant_id,
        name: variantName(product, v),
        attributes: { ...v.attributes },
        price: fmt(toCents(v.price)),
        currency: "USD" as const,
        stock: v.stock,
        in_stock: v.stock > 0,
        purchasable: isPurchasable(v),
        flags: [...(v.flags ?? [])],
        lead_time_days: v.lead_time_days ?? 0,
        availability: availability(v),
        delivery: this.delivery(v),
      })),
    };
  }

  private delivery(v: FeedVariant): DeliveryEstimate[] {
    const start = addDays(this.now(), v.lead_time_days ?? 0);
    return quoteShipping({ country_code: "US" }, toCents(v.price), start).map((q) => ({
      id: q.id,
      name: q.name,
      price: fmt(q.priceCents),
      estimated_delivery: q.estimatedDelivery,
    }));
  }

  private hit(doc: Doc, score: number): ProductHit {
    const { shop, product, variant: v } = doc;
    return {
      shop: shop.slug,
      shop_name: shop.name,
      parent_id: product.parent_id,
      variant_id: v.variant_id,
      name: variantName(product, v),
      ...(product.category ? { category: product.category } : {}),
      attributes: { ...v.attributes },
      price: fmt(toCents(v.price)),
      currency: "USD",
      stock: v.stock,
      in_stock: v.stock > 0,
      purchasable: isPurchasable(v),
      flags: [...(v.flags ?? [])],
      lead_time_days: v.lead_time_days ?? 0,
      availability: availability(v),
      score: Math.round(score * 100) / 100,
    };
  }
}
