export const SANDBOX_BASE = "https://api-m.sandbox.paypal.com" as const;
export const LIVE_BASE = "https://api-m.paypal.com" as const;

export interface PayPalEnv {
  /** Platform REST app client id (also the `iss` of auth assertions). */
  clientId: string;
  clientSecret: string;
  base: typeof SANDBOX_BASE | typeof LIVE_BASE;
  /** Partner attribution (BN) code, sent as `PayPal-Partner-Attribution-Id` on platform calls. */
  bnCode?: string;
  /** The platform's own PayPal merchant id; needed to read seller onboarding status. */
  partnerMerchantId?: string;
}

/** A decimal amount, e.g. `{ currency: "USD", value: "12.50" }`. */
export interface Money {
  currency: string;
  value: string;
}

/**
 * The purchase-unit amount. `total` must equal
 * itemTotal + shipping + handling + taxTotal + insurance − shippingDiscount − discount,
 * and `itemTotal` must equal Σ unitAmount × quantity over the items.
 */
export interface Breakdown {
  currency: string;
  total: string;
  itemTotal: string;
  shipping?: string;
  handling?: string;
  taxTotal?: string;
  insurance?: string;
  shippingDiscount?: string;
  discount?: string;
}

export interface OrderItem {
  name: string;
  /** Whole units, at least 1. */
  quantity: number;
  /** Unit price in the breakdown currency, e.g. "25.00". */
  unitAmount: string;
  sku?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  category?: "PHYSICAL_GOODS" | "DIGITAL_GOODS" | "DONATION";
}

export interface ShippingAddress {
  line1: string;
  line2?: string;
  city: string;
  /** State / province code, e.g. "CA". */
  state?: string;
  postalCode: string;
  countryCode: string;
}

export interface OrderShipping {
  fullName?: string;
  address: ShippingAddress;
}

export interface OrderView {
  id: string;
  status: string;
  intent?: string;
  customId?: string;
  payerId?: string;
  payerEmail?: string;
  amount?: Money;
  payeeMerchantId?: string;
  authorizationId?: string;
  authorizationStatus?: string;
  captureId?: string;
  captureStatus?: string;
  approveUrl?: string;
}
