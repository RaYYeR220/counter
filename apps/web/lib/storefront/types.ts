// Serializable shapes passed from storefront server code to client components
// and returned by the storefront API routes.

export interface ShopPolicyView {
  returnsDays: number;
  shipsFrom: string;
  handlingDays: number;
}

export interface ShopSummary {
  slug: string;
  name: string;
  owner: string;
  city: string;
  state: string;
  tagline: string;
  about: string;
  policy: ShopPolicyView;
}

export interface VariantView {
  variantId: string;
  name: string;
  attributes: Record<string, string>;
  priceCents: number;
  stock: number;
  flags: string[];
  purchasable: boolean;
  active: boolean;
  leadTimeDays: number;
}

export type AvailabilityKind = "in_stock" | "partial" | "sold_out" | "not_sold_alone" | "unavailable";

export interface ProductView {
  parentId: string;
  name: string;
  category: string;
  description: string;
  /** Attribute keys in the order the shop lists them, e.g. ["glaze", "size"]. */
  attributeOrder: string[];
  variants: VariantView[];
  /** Lowest price among variants that can be bought. */
  fromCents: number;
  /** True when variants differ in price. */
  priceVaries: boolean;
  availability: { kind: AvailabilityKind; label: string };
  /** Flags carried by any variant, in a stable order. */
  flags: string[];
}

export interface ShopView extends ShopSummary {
  products: ProductView[];
}

/** What a product drawing needs to know. */
export interface ArtSubject {
  category: string;
  parentId: string;
  productName: string;
  attributes: Record<string, string>;
  flags: string[];
}

export interface DeliveryQuote {
  id: string;
  name: string;
  priceCents: number;
  /** YYYY-MM-DD */
  estimatedDelivery: string;
}

export interface CartLineInput {
  variant_id: string;
  quantity: number;
}

export interface AddressInput {
  address_line_1?: string;
  address_line_2?: string;
  admin_area_2?: string;
  admin_area_1?: string;
  postal_code?: string;
  country_code: "US";
}

export interface QuoteLine {
  variant_id: string;
  parent_id: string;
  product_name: string;
  name: string;
  category: string;
  attributes: Array<{ key: string; label: string; value: string }>;
  flags: string[];
  quantity: number;
  unit_cents: number;
  line_cents: number;
  stock: number;
  purchasable: boolean;
  active: boolean;
  lead_time_days: number;
}

export interface QuoteIssue {
  variant_id?: string;
  code: string;
  message: string;
}

export interface QuoteShippingOption {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  estimated_delivery: string;
  is_selected: boolean;
}

export interface Quote {
  lines: QuoteLine[];
  /** Variant ids in the request that the shop does not sell. */
  unknown: string[];
  issues: QuoteIssue[];
  validation_status: "VALID" | "INVALID" | "REQUIRES_ADDITIONAL_INFORMATION";
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  /** Tax depends on the state; until one is given, tax and total exclude it. */
  tax_pending: boolean;
  shipping_options: QuoteShippingOption[];
  free_shipping_from_cents: number;
}

export type CheckoutResponse =
  | { status: "redirect"; approval_url: string; cart_id: string }
  | { status: "bench"; message: string; total_cents: number }
  | { status: "invalid"; message: string; issues: QuoteIssue[] }
  | { status: "not_configured"; message: string }
  | { status: "error"; message: string };
