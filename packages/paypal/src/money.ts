import type { Breakdown, OrderItem } from "./env";

const DECIMAL = /^\d+(\.\d{1,2})?$/;

export function toCents(value: string, field: string): number {
  if (!DECIMAL.test(value)) throw new RangeError(`${field}: "${value}" is not a decimal amount with up to 2 places`);
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function fmt(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Rejects amounts PayPal would refuse with AMOUNT_MISMATCH / ITEM_TOTAL_MISMATCH. */
export function checkAmount(b: Breakdown, items: OrderItem[]): void {
  const c = (v: string | undefined, f: string) => (v === undefined ? 0 : toCents(v, f));
  const sum =
    c(b.itemTotal, "itemTotal") +
    c(b.shipping, "shipping") +
    c(b.handling, "handling") +
    c(b.taxTotal, "taxTotal") +
    c(b.insurance, "insurance") -
    c(b.shippingDiscount, "shippingDiscount") -
    c(b.discount, "discount");
  const total = c(b.total, "total");
  if (sum !== total) {
    throw new RangeError(`amount total ${b.total} does not equal the breakdown sum ${fmt(sum)}`);
  }
  if (items.length === 0) return;
  let itemsSum = 0;
  for (const [i, item] of items.entries()) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RangeError(`items[${i}].quantity must be a whole number of at least 1`);
    }
    itemsSum += toCents(item.unitAmount, `items[${i}].unitAmount`) * item.quantity;
  }
  if (itemsSum !== c(b.itemTotal, "itemTotal")) {
    throw new RangeError(`item_total ${b.itemTotal} does not equal the items sum ${fmt(itemsSum)}`);
  }
}

/** PayPal wire shape for a money value. */
export function wireMoney(currency: string, value: string): { currency_code: string; value: string } {
  return { currency_code: currency, value };
}
