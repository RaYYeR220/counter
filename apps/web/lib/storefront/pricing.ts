import "server-only";
import { DbCatalog, listVariants } from "@counter/db";
import { computeCart, FREE_STANDARD_FROM_CENTS, toCents, type PayPalCart } from "@counter/store-sync";
import { z } from "zod";
import { db, storeNow } from "@/lib/server/runtime";
import { attributeOrder } from "./catalog";
import { attributeLabel } from "./format";
import type { AddressInput, CartLineInput, Quote, QuoteLine } from "./types";

export const LinesSchema = z
  .array(
    z.object({
      variant_id: z.string().trim().min(1).max(120),
      quantity: z.number().int().min(1).max(999),
    }),
  )
  .min(1)
  .max(50);

export const PartialAddressSchema = z.object({
  address_line_1: z.string().trim().max(300).optional(),
  address_line_2: z.string().trim().max(300).optional(),
  admin_area_2: z.string().trim().max(120).optional(),
  admin_area_1: z.string().trim().toUpperCase().max(2).optional(),
  postal_code: z.string().trim().max(10).optional(),
  country_code: z.literal("US").default("US"),
});

export const FullAddressSchema = z.object({
  address_line_1: z.string().trim().min(1, "Enter a street address").max(300),
  address_line_2: z.string().trim().max(300).optional(),
  admin_area_2: z.string().trim().min(1, "Enter a city").max(120),
  admin_area_1: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Choose a state"),
  postal_code: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code"),
  country_code: z.literal("US"),
});

export const ShippingOptionSchema = z.enum(["STANDARD", "EXPRESS"]);

export interface QuoteRequest {
  lines: CartLineInput[];
  address?: AddressInput | undefined;
  shippingOption?: "STANDARD" | "EXPRESS" | undefined;
  /** Customer name for the PayPal order; not used for pricing. */
  customer?: { given_name: string; surname: string } | undefined;
}

function clean(address: AddressInput | undefined): AddressInput {
  const out: AddressInput = { country_code: "US" };
  if (!address) return out;
  for (const key of ["address_line_1", "address_line_2", "admin_area_2", "admin_area_1", "postal_code"] as const) {
    const value = address[key]?.trim();
    if (value) out[key] = value;
  }
  return out;
}

/**
 * The Store Sync cart body for a storefront cart. Shipping options carry only
 * the buyer's choice; the engine re-quotes them.
 */
export function storeSyncCart(req: QuoteRequest): PayPalCart {
  const address = clean(req.address);
  const chosen = req.shippingOption ?? "STANDARD";
  return {
    items: req.lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity })),
    shipping_address: address,
    ...(req.customer ? { customer: { name: { given_name: req.customer.given_name, surname: req.customer.surname } } } : {}),
    available_shipping_options: [
      { id: chosen, name: chosen === "EXPRESS" ? "Express" : "Standard", price: { currency_code: "USD", value: "0.00" }, is_selected: true },
    ],
  };
}

/**
 * Prices a storefront cart with the Store Sync engine against the shop's
 * catalog, exactly as an agent's cart is priced. Until a state is given, tax
 * is left out (and reported as pending) rather than guessed.
 */
export async function quoteCart(slug: string, req: QuoteRequest, now: Date = storeNow()): Promise<Quote> {
  const cart = storeSyncCart(req);
  const state = cart.shipping_address?.admin_area_1;
  const [computed, rows] = await Promise.all([
    computeCart(cart, new DbCatalog(db()), slug, { now }),
    listVariants(db(), slug),
  ]);

  const bySku = new Map(rows.map((r) => [r.variantId, r]));
  const orderByParent = new Map<string, string[]>();
  const lines: QuoteLine[] = [];
  const unknown: string[] = [];
  for (const l of req.lines) {
    const row = bySku.get(l.variant_id);
    if (!row) {
      unknown.push(l.variant_id);
      continue;
    }
    let order = orderByParent.get(row.parentId);
    if (!order) {
      order = attributeOrder(
        row.productName,
        rows.filter((r) => r.parentId === row.parentId),
      );
      orderByParent.set(row.parentId, order);
    }
    lines.push({
      variant_id: row.variantId,
      parent_id: row.parentId,
      product_name: row.productName,
      name: row.name,
      category: row.category,
      attributes: order
        .filter((k) => row.attributes[k] !== undefined)
        .map((k) => ({ key: k, label: attributeLabel(k), value: row.attributes[k]! })),
      flags: [...row.flags],
      quantity: l.quantity,
      unit_cents: row.priceCents,
      line_cents: row.priceCents * l.quantity,
      stock: row.stock,
      purchasable: row.purchasable,
      active: row.active,
      lead_time_days: row.leadTimeDays,
    });
  }

  const { subtotal, discount, shipping, tax } = computed.amounts;
  const taxPending = !state;
  const issues = computed.issues
    .filter((i) => i.type !== "MISSING_FIELD")
    .map((i) => ({
      ...(i.variant_id ? { variant_id: i.variant_id } : {}),
      code: String((i.context as { specific_issue?: string } | undefined)?.specific_issue ?? i.code),
      message: i.user_message ?? i.message,
    }));

  return {
    lines,
    unknown,
    issues,
    validation_status: computed.validationStatus,
    subtotal_cents: subtotal,
    discount_cents: discount,
    shipping_cents: shipping,
    tax_cents: taxPending ? 0 : tax,
    total_cents: subtotal - discount + shipping + (taxPending ? 0 : tax),
    tax_pending: taxPending,
    shipping_options: computed.shipping.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description ?? "",
      price_cents: toCents(o.price.value),
      estimated_delivery: o.estimated_delivery ?? "",
      is_selected: o.is_selected,
    })),
    free_shipping_from_cents: FREE_STANDARD_FROM_CENTS,
  };
}
