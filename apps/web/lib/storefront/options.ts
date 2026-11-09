import { defaultVariant, sellable } from "./pick";
import type { ProductView, VariantView } from "./types";

// Option pickers that follow the shop's attribute order. An option is offered
// when some variant has it together with the options chosen above it, and is
// sold out when every such variant is out of stock.

export type Selection = Record<string, string>;

export interface OptionState {
  value: string;
  soldOut: boolean;
  unavailable: boolean;
}

function matchesPrefix(v: VariantView, order: string[], sel: Selection, upTo: number): boolean {
  for (let j = 0; j < upTo; j++) {
    const key = order[j]!;
    if (v.attributes[key] !== sel[key]) return false;
  }
  return true;
}

export function findVariant(p: ProductView, sel: Selection): VariantView | undefined {
  return p.variants.find((v) => p.attributeOrder.every((k) => v.attributes[k] === sel[k]));
}

export function initialSelection(p: ProductView, variantId: string | undefined): Selection {
  const v = (variantId && p.variants.find((x) => x.variantId === variantId)) || defaultVariant(p);
  return { ...v.attributes };
}

export function optionsFor(p: ProductView, sel: Selection, level: number): OptionState[] {
  const order = p.attributeOrder;
  const key = order[level]!;
  const values: string[] = [];
  for (const v of p.variants) {
    const value = v.attributes[key];
    if (value !== undefined && !values.includes(value)) values.push(value);
  }
  const out: OptionState[] = [];
  for (const value of values) {
    const candidates = p.variants.filter((v) => v.attributes[key] === value && matchesPrefix(v, order, sel, level));
    if (candidates.length === 0) continue;
    const active = candidates.filter((v) => v.active);
    out.push({
      value,
      unavailable: active.length === 0,
      soldOut: active.length > 0 && active.every((v) => v.stock <= 0),
    });
  }
  return out;
}

/**
 * Applies a choice and fixes the options below it. Each one keeps its value
 * whenever that combination exists, even if it is sold out, so a choice is
 * never changed behind the buyer's back. Only a value the shop does not offer
 * with the new choice moves, to the first combination in stock.
 */
export function choose(p: ProductView, sel: Selection, key: string, value: string): Selection {
  const order = p.attributeOrder;
  const level = order.indexOf(key);
  const next: Selection = { ...sel, [key]: value };
  for (let j = level + 1; j < order.length; j++) {
    const k = order[j]!;
    const candidates = p.variants.filter((v) => matchesPrefix(v, order, next, j));
    if (candidates.some((v) => v.attributes[k] === next[k])) continue;
    const pick = candidates.find(sellable) ?? candidates.find((v) => v.active && v.stock > 0) ?? candidates[0];
    if (pick) next[k] = pick.attributes[k]!;
  }
  return next;
}
