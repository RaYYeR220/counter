import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { listVariants, type Shop, type Variant } from "@counter/db";
import { FREE_STANDARD_FROM_CENTS, quoteShipping } from "@counter/store-sync";
import { db, loadShop } from "@/lib/server/runtime";
import type { AvailabilityKind, DeliveryQuote, ProductView, ShopSummary, ShopView, VariantView } from "./types";

export { FREE_STANDARD_FROM_CENTS };

/** Flat shipping prices (US), read from the shipping engine. */
export function shippingRates(): { standardCents: number; expressCents: number; freeFromCents: number } {
  const quotes = quoteShipping({ country_code: "US" }, 0, new Date(0));
  return {
    standardCents: quotes.find((q) => q.id === "STANDARD")?.priceCents ?? 0,
    expressCents: quotes.find((q) => q.id === "EXPRESS")?.priceCents ?? 0,
    freeFromCents: FREE_STANDARD_FROM_CENTS,
  };
}

const FLAG_ORDER = ["seconds", "decaf", "limited", "made_to_order", "subscription_only"];

export function shopSummary(shop: Shop): ShopSummary {
  return {
    slug: shop.slug,
    name: shop.name,
    owner: shop.owner,
    city: shop.city,
    state: shop.state,
    tagline: shop.tagline,
    about: shop.about,
    policy: {
      returnsDays: shop.policy.returns_days,
      shipsFrom: shop.city,
      handlingDays: shop.policy.handling_days,
    },
  };
}

/**
 * The order a product's attributes are listed in. Variant names read
 * "Product — value, value" in the shop's display order, so the order is
 * recovered from the name; keys the name does not mention go last.
 */
export function attributeOrder(productName: string, variants: Pick<Variant, "name" | "attributes">[]): string[] {
  const keys = [...new Set(variants.flatMap((v) => Object.keys(v.attributes)))];
  for (const v of variants) {
    const prefix = `${productName} — `;
    if (!v.name.startsWith(prefix)) continue;
    const values = v.name.slice(prefix.length).split(", ");
    const order: string[] = [];
    for (const value of values) {
      const key = Object.keys(v.attributes).find((k) => v.attributes[k] === value && !order.includes(k));
      if (key) order.push(key);
    }
    if (order.length === Object.keys(v.attributes).length) {
      return [...order, ...keys.filter((k) => !order.includes(k))];
    }
  }
  return keys;
}

function availability(variants: VariantView[]): { kind: AvailabilityKind; label: string } {
  const live = variants.filter((v) => v.active);
  if (live.length === 0) return { kind: "unavailable", label: "No longer available" };
  const sellable = live.filter((v) => v.purchasable);
  if (sellable.length === 0) {
    return live.some((v) => v.flags.includes("subscription_only"))
      ? { kind: "not_sold_alone", label: "Subscription only" }
      : { kind: "unavailable", label: "Not sold individually" };
  }
  const stocked = sellable.filter((v) => v.stock > 0);
  if (stocked.length === 0) return { kind: "sold_out", label: "Sold out" };
  if (stocked.length < sellable.length) return { kind: "partial", label: "Some options sold out" };
  return { kind: "in_stock", label: "In stock" };
}

function productsOf(rows: Variant[]): ProductView[] {
  const byParent = new Map<string, Variant[]>();
  for (const row of rows) {
    const list = byParent.get(row.parentId);
    if (list) list.push(row);
    else byParent.set(row.parentId, [row]);
  }
  return [...byParent.values()].map((group) => {
    const first = group[0]!;
    const variants: VariantView[] = group.map((v) => ({
      variantId: v.variantId,
      name: v.name,
      attributes: { ...v.attributes },
      priceCents: v.priceCents,
      stock: v.stock,
      flags: [...v.flags],
      purchasable: v.purchasable,
      active: v.active,
      leadTimeDays: v.leadTimeDays,
    }));
    const buyable = variants.filter((v) => v.active && v.purchasable);
    const prices = (buyable.length ? buyable : variants).map((v) => v.priceCents);
    const flags = [...new Set(variants.flatMap((v) => v.flags))].sort(
      (a, b) => (FLAG_ORDER.indexOf(a) + 1 || 99) - (FLAG_ORDER.indexOf(b) + 1 || 99),
    );
    return {
      parentId: first.parentId,
      name: first.productName,
      category: first.category,
      description: first.description,
      attributeOrder: attributeOrder(first.productName, group),
      variants,
      fromCents: Math.min(...prices),
      priceVaries: new Set(prices).size > 1,
      availability: availability(variants),
      flags,
    };
  });
}

/** A shop and its catalog, read fresh once per request. Null for an unknown shop. */
export const getShopView = cache(async (slug: string): Promise<ShopView | null> => {
  // Stock and prices are read per request, never prerendered.
  await connection();
  const shop = await loadShop(slug);
  if (!shop) return null;
  const rows = await listVariants(db(), shop.slug);
  return { ...shopSummary(shop), products: productsOf(rows) };
});

export const getShopSummary = cache(async (slug: string): Promise<ShopSummary | null> => {
  await connection();
  const shop = await loadShop(slug);
  return shop ? shopSummary(shop) : null;
});

/**
 * Delivery quotes for a US address, by lead time, using the same shipping
 * rules as the cart. Standard is quoted at its full price; it ships free
 * once the cart subtotal reaches FREE_STANDARD_FROM_CENTS.
 */
export function deliveryQuotes(handlingDays: number, leadTimes: number[], now: Date): Record<number, DeliveryQuote[]> {
  const out: Record<number, DeliveryQuote[]> = {};
  for (const lead of new Set(leadTimes)) {
    out[lead] = quoteShipping({ country_code: "US" }, 0, now, { leadTimeDays: lead, handlingDays }).map((q) => ({
      id: q.id,
      name: q.name,
      priceCents: q.priceCents,
      estimatedDelivery: q.estimatedDelivery,
    }));
  }
  return out;
}
