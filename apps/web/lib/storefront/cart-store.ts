"use client";

import { useSyncExternalStore } from "react";
import type { CartLineInput } from "./types";

// The storefront cart lives in the browser, one per shop. It holds only
// variant ids and quantities; prices and totals always come from the server.

const EVENT = "storefront-cart";
const EMPTY: CartLineInput[] = [];

function keyFor(shop: string): string {
  return `storefront.cart.${shop}`;
}

function parse(raw: string | null): CartLineInput[] {
  if (!raw) return EMPTY;
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return EMPTY;
    const lines: CartLineInput[] = [];
    for (const item of data) {
      const id = (item as { variant_id?: unknown })?.variant_id;
      const qty = (item as { quantity?: unknown })?.quantity;
      if (typeof id === "string" && id && typeof qty === "number" && Number.isInteger(qty) && qty > 0) {
        lines.push({ variant_id: id, quantity: Math.min(qty, 999) });
      }
    }
    return lines;
  } catch {
    return EMPTY;
  }
}

const snapshots = new Map<string, { raw: string | null; lines: CartLineInput[] }>();

function readRaw(shop: string): string | null {
  try {
    return window.localStorage.getItem(keyFor(shop));
  } catch {
    return null;
  }
}

export function readCart(shop: string): CartLineInput[] {
  const raw = readRaw(shop);
  const hit = snapshots.get(shop);
  if (hit && hit.raw === raw) return hit.lines;
  const lines = parse(raw);
  snapshots.set(shop, { raw, lines });
  return lines;
}

export function writeCart(shop: string, lines: CartLineInput[]): void {
  const clean = lines.filter((l) => l.quantity > 0);
  try {
    if (clean.length) window.localStorage.setItem(keyFor(shop), JSON.stringify(clean));
    else window.localStorage.removeItem(keyFor(shop));
  } catch {
    // Storage can be unavailable (private mode, quota); the cart then lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: shop }));
}

/** Adds `quantity` of a variant, never past `max`. Returns how many were added. */
export function addToCart(shop: string, variantId: string, quantity: number, max: number): { added: number; inCart: number } {
  const lines = readCart(shop);
  const existing = lines.find((l) => l.variant_id === variantId)?.quantity ?? 0;
  const next = Math.max(existing, Math.min(existing + quantity, max));
  const added = next - existing;
  if (added > 0) {
    const updated = lines.some((l) => l.variant_id === variantId)
      ? lines.map((l) => (l.variant_id === variantId ? { ...l, quantity: next } : l))
      : [...lines, { variant_id: variantId, quantity: next }];
    writeCart(shop, updated);
  }
  return { added, inCart: next };
}

export function setLineQuantity(shop: string, variantId: string, quantity: number): void {
  writeCart(
    shop,
    readCart(shop).map((l) => (l.variant_id === variantId ? { ...l, quantity } : l)),
  );
}

export function removeLine(shop: string, variantId: string): void {
  writeCart(
    shop,
    readCart(shop).filter((l) => l.variant_id !== variantId),
  );
}

export function clearCart(shop: string): void {
  writeCart(shop, []);
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** The shop's cart lines; empty during server rendering. */
export function useCart(shop: string): CartLineInput[] {
  return useSyncExternalStore(
    subscribe,
    () => readCart(shop),
    () => EMPTY,
  );
}

/** False during server rendering and hydration, true after. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function noopSubscribe(): () => void {
  return () => {};
}
