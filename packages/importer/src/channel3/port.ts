/** A merchant's price for a Channel3 product. */
export interface C3Offer {
  url: string;
  domain: string;
  price: { price: number; currency: string; compare_at_price?: number | null };
  availability?: string | null;
  condition?: string | null;
  dimensions?: {
    length?: C3Measure | null;
    width?: C3Measure | null;
    height?: C3Measure | null;
    weight?: C3Measure | null;
  } | null;
}

export interface C3Measure {
  number: number;
  unit: string;
}

export interface C3OptionValue {
  label: string;
  exists?: boolean | null;
  available?: boolean | null;
  product_id?: string | null;
}

/** Channel3's product model, as far as the importer reads it. Every field past `id` and `title` may be missing. */
export interface C3Product {
  id: string;
  title: string;
  description?: string | null;
  brands?: Array<{ id?: string; name: string }> | null;
  images?: Array<{ url: string; cleaned_url?: string | null; is_main_image?: boolean | null }> | null;
  category?: { slug: string; title: string; path?: Array<{ slug: string; title: string }> } | null;
  materials?: string[] | null;
  key_features?: string[] | null;
  offers?: C3Offer[] | null;
  variants?: {
    options?: Array<{ name: string; values: C3OptionValue[] }> | null;
    selected?: Array<{ name: string; label: string }> | null;
  } | null;
  structured_attributes?: Record<string, string[]> | null;
}

export interface C3SearchRequest {
  query?: string;
  /** Raw base64 image bytes (no `data:` prefix). Only used where `imageSearch` is true. */
  imageBase64?: string;
  /** Up to 30 over REST; the MCP server returns at most 8. */
  limit?: number;
}

/**
 * Channel3's product data: search across 100M+ products, and product page
 * lookup with structured attributes, variants and every merchant's offer.
 */
export interface Channel3 {
  readonly kind: "mcp" | "rest";
  /** Whether `search` accepts an uploaded image. */
  readonly imageSearch: boolean;
  search(req: C3SearchRequest): Promise<C3Product[]>;
  /** The product on a retailer's product page, or null when Channel3 cannot resolve it. */
  lookup(url: string): Promise<C3Product | null>;
  /** Full products by Channel3 id. */
  products(ids: string[]): Promise<C3Product[]>;
  close?(): Promise<void>;
}

export type Channel3ErrorCode = "not_a_product_page" | "rate_limited" | "out_of_credits" | "unauthorized" | "bad_request" | "unavailable";

export class Channel3Error extends Error {
  override readonly name = "Channel3Error";

  constructor(
    message: string,
    readonly code: Channel3ErrorCode,
    readonly status?: number,
  ) {
    super(message);
  }
}
