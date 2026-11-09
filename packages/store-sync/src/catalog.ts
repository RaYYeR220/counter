import type { Cents } from "./money";

/** One purchasable variant as the merchant's catalog knows it. */
export interface CatalogVariant {
  variantId: string;
  parentId: string;
  name: string;
  url: string;
  priceCents: Cents;
  stock: number;
  attributes: Record<string, string>;
  active: boolean;
  /** Calendar days before the item is ready to ship (made-to-order work). */
  leadTimeDays?: number;
  /** Business days the shop needs to pack and hand over a ready order. */
  handlingDays?: number;
}

export interface CatalogPort {
  getVariant(shopId: string, variantId: string): Promise<CatalogVariant | null>;
}
