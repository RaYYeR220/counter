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
}

export interface CatalogPort {
  getVariant(shopId: string, variantId: string): Promise<CatalogVariant | null>;
}
