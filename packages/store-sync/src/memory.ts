import type { CatalogPort, CatalogVariant } from "./catalog";

/** Catalog held in memory, keyed by shop. Handy for local runs and tests. */
export class MemoryCatalog implements CatalogPort {
  private readonly shops = new Map<string, Map<string, CatalogVariant>>();

  constructor(variantsByShop: Record<string, CatalogVariant[]> = {}) {
    for (const [shopId, variants] of Object.entries(variantsByShop)) {
      for (const v of variants) this.upsert(shopId, v);
    }
  }

  upsert(shopId: string, v: CatalogVariant): void {
    let shop = this.shops.get(shopId);
    if (!shop) this.shops.set(shopId, (shop = new Map()));
    shop.set(v.variantId, { ...v, attributes: { ...v.attributes } });
  }

  async getVariant(shopId: string, variantId: string): Promise<CatalogVariant | null> {
    const v = this.shops.get(shopId)?.get(variantId);
    return v ? { ...v, attributes: { ...v.attributes } } : null;
  }
}
