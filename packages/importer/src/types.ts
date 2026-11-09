/** Where a draft came from: a product page, a photo, or a CSV paste. */
export interface DraftSource {
  kind: "url" | "photo" | "csv";
  /** The cleaned product page URL, the photo's file name, or the CSV row numbers. */
  ref?: string;
  /** For a URL import, the site whose offer priced the draft; its listings are not counted as market. */
  merchant?: string;
}

/** One purchasable variant, before it gets a shop prefix and goes into `variants`. */
export interface VariantDraft {
  /** Provisional id without the shop prefix; `toVariantRows` assigns the final one. */
  variantId: string;
  /** Buyer-facing choices, keyed by snake_case attribute name, e.g. `{ glaze: "sage", size: "12 oz" }`. */
  attributes: Record<string, string>;
  priceCents: number;
  /** 0 means unknown; the draft carries a warning until the merchant sets it. */
  stock: number;
  costCents?: number;
  /** Lowest unit price the seller agent may agree to. See `suggestFloor`. */
  floorCents: number;
  flags: string[];
  purchasable: boolean;
  leadTimeDays: number;
  weightG?: number;
}

/** What other merchants charge for comparable products, from Channel3. */
export interface MarketCheck {
  comparable: Array<{ title: string; merchant: string; priceCents: number; url: string }>;
  /**
   * Lower quartile of the comparable prices (the minimum when there are
   * fewer than four), so one clearance listing does not set the range.
   */
  lowCents: number;
  medianCents: number;
  /** Upper quartile (the maximum when there are fewer than four). */
  highCents: number;
  /** Where our reference price sits against `lowCents`..`highCents`. */
  position: "below" | "within" | "above";
  /** The price that was compared: the product's median variant price. */
  priceCents?: number;
  /** ISO time of the check. */
  checkedAt: string;
}

/** A product as an import produced it, for the merchant to review before publishing. */
export interface ProductDraft {
  /** Uppercase hyphenated slug without the shop prefix, e.g. `MORNING-MUG`. */
  parentId: string;
  name: string;
  category: string;
  description: string;
  /** Attributes buyers choose between, in the order a listing shows them. */
  attributesOrder: string[];
  variants: VariantDraft[];
  source: DraftSource;
  market?: MarketCheck;
  /** Things the merchant should check or fill in before publishing. */
  warnings: string[];
}

/** The part of a shop's negotiation policy the floor rule needs. */
export interface FloorPolicy {
  /** Largest discount off list price the seller agent may give, in percent. */
  maxDiscountPct: number;
}
