import { listShops, listVariants, type Db, type Shop, type Variant } from "@counter/db";
import {
  JsonShopDirectory,
  type CatalogFeed,
  type FeedProduct,
  type FeedShop,
  type ProductDetail,
  type ProductHit,
  type SearchQuery,
  type ShopDirectory,
  type ShopSummary,
} from "@counter/gateway";
import { fmt } from "@counter/store-sync";

/** Builds the agent-facing catalog feed from shop and variant rows (catalog order kept). */
export function feedFromRows(shops: Array<{ shop: Shop; variants: Variant[] }>): CatalogFeed {
  return {
    shops: shops.map(({ shop, variants }): FeedShop => {
      const products = new Map<string, FeedProduct>();
      for (const v of variants) {
        let p = products.get(v.parentId);
        if (!p) {
          p = {
            parent_id: v.parentId,
            name: v.productName,
            category: v.category,
            description: v.description,
            attributes_order: Object.keys(v.attributes),
            variants: [],
          };
          products.set(v.parentId, p);
        }
        p.variants.push({
          variant_id: v.variantId,
          attributes: { ...v.attributes },
          price: fmt(v.priceCents),
          stock: v.stock,
          active: v.active,
          purchasable: v.purchasable,
          lead_time_days: v.leadTimeDays,
          flags: [...v.flags],
        });
      }
      return {
        slug: shop.slug,
        name: shop.name,
        tagline: shop.tagline,
        about: shop.about,
        city: shop.city,
        state: shop.state,
        policy: {
          returns_days: shop.policy.returns_days,
          ships_from_state: shop.policy.ships_from_state,
          handling_days: shop.policy.handling_days,
        },
        products: [...products.values()],
      };
    }),
  };
}

/**
 * Shop directory backed by the database. Stock moves with every order, so the
 * feed is rebuilt after a short TTL rather than held for the process lifetime.
 */
/** Shops created from Studio's "Create a test shop". */
export function isTestShop(slug: string): boolean {
  return slug.startsWith("try-");
}

export class DbShopDirectory implements ShopDirectory {
  private cached?: { at: number; dir: JsonShopDirectory };

  constructor(
    private readonly db: Db,
    private readonly opts: { ttlMs?: number; now?: () => Date; include?: string } = {},
  ) {}

  private async dir(): Promise<JsonShopDirectory> {
    const ttl = this.opts.ttlMs ?? 15_000;
    if (this.cached && Date.now() - this.cached.at < ttl) return this.cached.dir;
    // Test shops made in Studio stay out of discovery; they are still reachable by slug.
    const shops = (await listShops(this.db)).filter((s) => !isTestShop(s.slug) || s.slug === this.opts.include);
    const rows = await Promise.all(shops.map(async (shop) => ({ shop, variants: await listVariants(this.db, shop.slug) })));
    const dir = new JsonShopDirectory(feedFromRows(rows), this.opts.now ? { now: this.opts.now } : {});
    this.cached = { at: Date.now(), dir };
    return dir;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  async listShops(): Promise<ShopSummary[]> {
    return (await this.dir()).listShops();
  }

  async search(q: SearchQuery): Promise<ProductHit[]> {
    if (q.shop && isTestShop(q.shop)) return (await this.testShop(q.shop)).search(q);
    return (await this.dir()).search(q);
  }

  async getProduct(shop: string, parentId: string): Promise<ProductDetail | null> {
    if (isTestShop(shop)) return (await this.testShop(shop)).getProduct(shop, parentId);
    return (await this.dir()).getProduct(shop, parentId);
  }

  /** A directory over one test shop, for agents that were given its slug. */
  private async testShop(slug: string): Promise<JsonShopDirectory> {
    const shop = (await listShops(this.db)).find((s) => s.slug === slug);
    const rows = shop ? [{ shop, variants: await listVariants(this.db, slug) }] : [];
    return new JsonShopDirectory(feedFromRows(rows), this.opts.now ? { now: this.opts.now } : {});
  }
}
