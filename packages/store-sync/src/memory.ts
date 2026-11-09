import type { CatalogPort, CatalogVariant } from "./catalog";
import type { CartRecord, CartRepo } from "./ports";

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

/** Cart storage held in memory. Records are copied in and out, like a real store. */
export class MemoryCartRepo implements CartRepo {
  private readonly rows = new Map<string, CartRecord>();

  private key(shopId: string, id: string): string {
    return `${shopId}\u0000${id}`;
  }

  get size(): number {
    return this.rows.size;
  }

  async insert(r: CartRecord): Promise<void> {
    const k = this.key(r.shopId, r.id);
    if (this.rows.has(k)) throw new Error(`Cart ${r.id} already exists`);
    this.rows.set(k, structuredClone(r));
  }

  async get(shopId: string, id: string): Promise<CartRecord | null> {
    const r = this.rows.get(this.key(shopId, id));
    return r ? structuredClone(r) : null;
  }

  async update(r: CartRecord): Promise<void> {
    const k = this.key(r.shopId, r.id);
    if (!this.rows.has(k)) throw new Error(`Cart ${r.id} does not exist`);
    this.rows.set(k, structuredClone(r));
  }
}
