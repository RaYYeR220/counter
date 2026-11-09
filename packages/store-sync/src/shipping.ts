import type { Cents } from "./money";
import type { Address } from "./types";

export type ShippingOptionId = "STANDARD" | "EXPRESS";

export interface ShippingQuote {
  id: ShippingOptionId;
  name: string;
  description: string;
  priceCents: Cents;
  /** YYYY-MM-DD */
  estimatedDelivery: string;
}

export const DEFAULT_SHIPPING_OPTION: ShippingOptionId = "STANDARD";
export const SHIPPING_COUNTRIES = ["US"] as const;

/** STANDARD ships free once the item subtotal reaches this amount. */
export const FREE_STANDARD_FROM_CENTS: Cents = 7500;

const RATES: ReadonlyArray<{
  id: ShippingOptionId;
  name: string;
  description: string;
  priceCents: Cents;
  businessDays: number;
}> = [
  {
    id: "STANDARD",
    name: "Standard",
    description: "Arrives in about 5 business days",
    priceCents: 599,
    businessDays: 5,
  },
  {
    id: "EXPRESS",
    name: "Express",
    description: "Arrives in about 2 business days",
    priceCents: 1499,
    businessDays: 2,
  },
];

export function shipsTo(addr: Pick<Address, "country_code"> | null | undefined): boolean {
  const cc = addr?.country_code?.trim().toUpperCase();
  return !!cc && (SHIPPING_COUNTRIES as readonly string[]).includes(cc);
}

/** Calendar date (UTC) that is `days` business days after `from`. */
export function addBusinessDays(from: Date, days: number): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Shipping quotes for an address. Domestic (US) only: anywhere else, or no
 * address at all, yields no options.
 */
export function quoteShipping(
  addr: Address | null | undefined,
  subtotal: Cents,
  now: Date,
): ShippingQuote[] {
  if (!shipsTo(addr)) return [];
  return RATES.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    priceCents: r.id === "STANDARD" && subtotal >= FREE_STANDARD_FROM_CENTS ? 0 : r.priceCents,
    estimatedDelivery: addBusinessDays(now, r.businessDays),
  }));
}
