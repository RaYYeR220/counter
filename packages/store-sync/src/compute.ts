import type { CatalogPort, CatalogVariant } from "./catalog";
import {
  discountCodeInvalid,
  insufficientInventory,
  internationalShipping,
  itemDiscontinued,
  itemNotFound,
  missingShippingAddress,
  outOfStock,
} from "./issues";
import { money, type Cents } from "./money";
import { DEFAULT_SHIPPING_OPTION, quoteShipping, shipsTo, type ShippingQuote } from "./shipping";
import { taxCents } from "./tax";
import type {
  AppliedDiscount,
  CartItem,
  CartTotals,
  Money,
  PaymentMethod,
  PayPalCart,
  ShippingOption,
  ValidationIssue,
} from "./types";

export type ValidationStatus = "VALID" | "INVALID" | "REQUIRES_ADDITIONAL_INFORMATION";
export type CartStatus = "CREATED" | "INCOMPLETE" | "COMPLETED";

/** A discount granted to this cart by the merchant (for example, a negotiated deal). */
export interface AppliedDiscountIn {
  code: string;
  /** Restricts the discount to one line; omitted means it applies to the whole cart. */
  variantId?: string;
  amountCents: Cents;
  description: string;
}

/** A response item: always carries a unit `price`. */
export type CartItemOut = CartItem & { price: Money };

/** An item that resolved to a catalog variant, with its authoritative price. */
export interface PricedLine {
  index: number;
  variantId: string;
  parentId: string;
  name: string;
  url: string;
  quantity: number;
  unitCents: Cents;
}

export interface CartAmounts {
  subtotal: Cents;
  discount: Cents;
  shipping: Cents;
  tax: Cents;
  total: Cents;
}

export interface ComputedCart {
  items: CartItemOut[];
  issues: ValidationIssue[];
  shipping: ShippingOption[];
  totals: CartTotals;
  validationStatus: ValidationStatus;
  amounts: CartAmounts;
  discounts?: { codes?: string[]; applied: AppliedDiscount[] };
  selectedShipping?: ShippingQuote;
  /** Items that resolved to a catalog variant (in request order). */
  lines: PricedLine[];
  /** How many request items matched a catalog variant. */
  resolvedCount: number;
}

export interface ComputeOptions {
  now: Date;
  discounts?: AppliedDiscountIn[];
}

function pricedItem(v: CatalogVariant, req: CartItem): CartItemOut {
  const attrs = Object.entries(v.attributes).map(([name, value]) => ({ name, value }));
  return {
    variant_id: v.variantId,
    parent_id: v.parentId,
    quantity: req.quantity,
    name: v.name,
    item_url: v.url,
    price: money(v.priceCents),
    ...(attrs.length ? { selected_attributes: attrs } : {}),
    ...(req.gift_options ? { gift_options: req.gift_options } : {}),
  };
}

function unknownItem(req: CartItem, requestedId: string): CartItemOut {
  return {
    variant_id: req.variant_id || requestedId,
    ...(req.parent_id ? { parent_id: req.parent_id } : {}),
    quantity: req.quantity,
    price: money(0),
  };
}

function normCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Prices a cart against the catalog: resolves every item, checks stock,
 * quotes shipping for the address, applies discounts and tax, and collects
 * validation issues. Prices, shipping costs and totals sent by the client are
 * never trusted; only the item ids, quantities, address and the id of the
 * selected shipping option are read from the request.
 */
export async function computeCart(
  input: PayPalCart,
  catalog: CatalogPort,
  shopId: string,
  opts: ComputeOptions,
): Promise<ComputedCart> {
  const reqItems = input.items ?? [];
  const ids = reqItems.map((it) => it.variant_id || it.parent_id || "");
  const found = await Promise.all(ids.map((id) => (id ? catalog.getVariant(shopId, id) : null)));

  const requestedPerVariant = new Map<string, number>();
  found.forEach((v, i) => {
    if (v) requestedPerVariant.set(v.variantId, (requestedPerVariant.get(v.variantId) ?? 0) + reqItems[i]!.quantity);
  });

  const items: CartItemOut[] = [];
  const lines: PricedLine[] = [];
  const issues: ValidationIssue[] = [];
  let subtotal = 0;
  let leadTimeDays = 0;
  let handlingDays = 0;

  reqItems.forEach((req, i) => {
    const v = found[i];
    if (!v) {
      issues.push(itemNotFound(req.variant_id || ids[i]!, i));
      items.push(unknownItem(req, ids[i]!));
      return;
    }
    items.push(pricedItem(v, req));
    lines.push({
      index: i,
      variantId: v.variantId,
      parentId: v.parentId,
      name: v.name,
      url: v.url,
      quantity: req.quantity,
      unitCents: v.priceCents,
    });
    subtotal += v.priceCents * req.quantity;
    leadTimeDays = Math.max(leadTimeDays, v.leadTimeDays ?? 0);
    handlingDays = Math.max(handlingDays, v.handlingDays ?? 0);

    const wanted = requestedPerVariant.get(v.variantId) ?? req.quantity;
    if (!v.active) issues.push(itemDiscontinued(v, i));
    else if (v.stock <= 0) issues.push(outOfStock(v, i, req.quantity));
    else if (wanted > v.stock) issues.push(insufficientInventory(v, i, v.stock, wanted));
  });

  // Discounts. `codes` echoes what the buyer entered; merchant-granted
  // discounts that no code asked for are reported as automatic.
  const requestedCodes = [...new Set((input.discounts?.codes ?? []).map((c) => c.trim()).filter(Boolean))];
  const requested = new Set(requestedCodes.map(normCode));
  const applied: AppliedDiscount[] = [];
  let discount = 0;
  for (const d of opts.discounts ?? []) {
    if (!Number.isSafeInteger(d.amountCents) || d.amountCents <= 0) {
      throw new RangeError(`Discount ${d.code} must be a positive whole number of cents`);
    }
    let cap = subtotal - discount;
    let lineIndex: number | undefined;
    if (d.variantId) {
      const line = lines.find((l) => l.variantId === d.variantId);
      if (!line) continue;
      lineIndex = line.index;
      cap = Math.min(cap, line.unitCents * line.quantity);
    }
    const amount = Math.min(d.amountCents, cap);
    if (amount <= 0) continue;
    discount += amount;
    applied.push({
      code: d.code,
      title: d.description,
      amount: money(amount),
      automatic: !requested.has(normCode(d.code)),
      method: lineIndex === undefined ? "ACROSS" : "EACH",
      ...(lineIndex === undefined ? {} : { allocations: [{ path: `items[${lineIndex}]`, amount: money(amount) }] }),
    });
  }
  const appliedCodes = new Set(applied.map((a) => normCode(a.code ?? "")));
  for (const code of requestedCodes) {
    if (!appliedCodes.has(normCode(code))) issues.push(discountCodeInvalid(code));
  }

  // Shipping
  const addr = input.shipping_address ?? undefined;
  if (!addr) issues.push(missingShippingAddress());
  else if (!shipsTo(addr)) issues.push(internationalShipping(addr.country_code));

  const quotes = quoteShipping(addr, subtotal, opts.now, { leadTimeDays, handlingDays });
  const wantedOption = input.available_shipping_options?.find((o) => o.is_selected)?.id;
  const selected =
    quotes.find((q) => q.id === wantedOption) ?? quotes.find((q) => q.id === DEFAULT_SHIPPING_OPTION) ?? quotes[0];
  const shippingOptions: ShippingOption[] = quotes.map((q) => ({
    id: q.id,
    name: q.name,
    description: q.description,
    price: money(q.priceCents),
    is_selected: q === selected,
    estimated_delivery: q.estimatedDelivery,
  }));
  const shipping = selected?.priceCents ?? 0;

  // Tax and totals
  const tax = selected && addr ? taxCents(addr.admin_area_1, subtotal - discount + shipping) : 0;
  const total = subtotal - discount + shipping + tax;
  const totals: CartTotals = {
    subtotal: money(subtotal),
    ...(discount > 0 ? { discount: money(discount) } : {}),
    shipping: money(shipping),
    tax: money(tax),
    total: money(total),
  };

  const validationStatus: ValidationStatus =
    issues.length === 0
      ? "VALID"
      : issues.every((i) => i.type === "MISSING_FIELD")
        ? "REQUIRES_ADDITIONAL_INFORMATION"
        : "INVALID";

  return {
    items,
    issues,
    shipping: shippingOptions,
    totals,
    validationStatus,
    amounts: { subtotal, discount, shipping, tax, total },
    ...(requestedCodes.length || applied.length
      ? { discounts: { ...(requestedCodes.length ? { codes: requestedCodes } : {}), applied } }
      : {}),
    ...(selected ? { selectedShipping: selected } : {}),
    lines,
    resolvedCount: lines.length,
  };
}

export interface AssembleMeta {
  id: string;
  status: CartStatus;
  /** Omitted until a payment token exists: a payment method is only reported with its token. */
  paymentMethod?: PaymentMethod | undefined;
}

/**
 * Builds the response cart from the request and the computed result. Buyer
 * data (customer, addresses, checkout fields, consents, coordinates) is echoed
 * as sent; everything else comes from the computation. Only keys defined by
 * the cart schema are emitted.
 */
export function assembleCart(input: PayPalCart, computed: ComputedCart, meta: AssembleMeta): PayPalCart {
  return {
    id: meta.id,
    status: meta.status,
    validation_status: computed.validationStatus,
    validation_issues: computed.issues,
    totals: computed.totals,
    ...(computed.discounts ? { discounts: computed.discounts } : {}),
    available_shipping_options: computed.shipping,
    items: computed.items,
    ...(input.customer ? { customer: input.customer } : {}),
    ...(input.shipping_address ? { shipping_address: input.shipping_address } : {}),
    ...(input.billing_address ? { billing_address: input.billing_address } : {}),
    ...(meta.paymentMethod ? { payment_method: meta.paymentMethod } : {}),
    ...(input.checkout_fields ? { checkout_fields: input.checkout_fields } : {}),
    ...(input.marketing_consents ? { marketing_consents: input.marketing_consents } : {}),
    ...(input.geo_coordinates ? { geo_coordinates: input.geo_coordinates } : {}),
  };
}
