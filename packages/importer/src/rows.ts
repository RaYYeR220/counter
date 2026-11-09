import { publicBaseUrl, storefrontUrl, type NewVariant, type Shop } from "@counter/db";
import { positionOf } from "./stats";
import { slug } from "./text";
import type { ProductDraft } from "./types";

/** Attribute keys in display order: `attributesOrder` first, then any others alphabetically. */
function orderedKeys(draft: ProductDraft): string[] {
  const all = new Set(draft.variants.flatMap((v) => Object.keys(v.attributes)));
  const first = draft.attributesOrder.filter((k) => all.has(k));
  const rest = [...all].filter((k) => !first.includes(k)).sort();
  return [...first, ...rest];
}

/** Keys whose value differs between the draft's variants; these tell variants apart. */
export function varyingKeys(draft: ProductDraft): string[] {
  return orderedKeys(draft).filter((k) => new Set(draft.variants.map((v) => v.attributes[k] ?? "")).size > 1);
}

/** `JC-MUG-SPECKLE` for parent "mug speckle" or "JC-MUG-SPECKLE" in shop JC; no prefix when `prefix` is empty. */
export function parentIdFor(prefix: string, parentId: string): string {
  const p = slug(prefix, 8);
  let base = slug(parentId, 40);
  if (!p) return base || "ITEM";
  if (base === p || base.startsWith(`${p}-`)) base = base.slice(p.length).replace(/^-/, "");
  return `${p}-${base || "ITEM"}`;
}

/**
 * Final variant ids for a draft, in variant order:
 * `<prefix>-<parent>-<values that vary>`, uppercase and hyphenated, e.g.
 * `JC-MORNING-MUG-SAGE-12-OZ`. The same draft always gets the same ids.
 * Values that collide after slugging get `-2`, `-3`... in variant order.
 * Pass `taken` to keep ids unique across several drafts; it is updated.
 */
export function assignVariantIds(draft: ProductDraft, prefix: string, taken: Set<string> = new Set()): string[] {
  const parent = parentIdFor(prefix, draft.parentId);
  const keys = varyingKeys(draft);
  return draft.variants.map((v) => {
    const values = keys.map((k) => slug(v.attributes[k] ?? "", 24)).filter(Boolean);
    const base = values.length ? `${parent}-${values.join("-")}` : parent;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
  });
}

/** "Morning mug — sage, 12 oz": the values that tell variants apart, or every value for a single variant. */
function variantName(draft: ProductDraft, attributes: Record<string, string>, keys: string[]): string {
  const values = keys.map((k) => attributes[k]).filter((x): x is string => Boolean(x));
  return values.length ? `${draft.name} — ${values.join(", ")}` : draft.name;
}

export interface VariantRowOptions {
  /** Origin the storefront is served from; defaults to `PUBLIC_BASE_URL`. */
  publicBaseUrl?: string;
  /** Catalog position of the first variant. */
  startPosition?: number;
  /** Ids already used in this batch. */
  taken?: Set<string>;
}

/** Rows for the `variants` table. Unknown cost and weight are stored as 0. */
export function toVariantRows(
  draft: ProductDraft,
  shop: Pick<Shop, "slug" | "orderPrefix">,
  opts: VariantRowOptions = {},
): NewVariant[] {
  const base = opts.publicBaseUrl ?? publicBaseUrl();
  const ids = assignVariantIds(draft, shop.orderPrefix, opts.taken);
  const parentId = parentIdFor(shop.orderPrefix, draft.parentId);
  const varying = varyingKeys(draft);
  const nameKeys = varying.length ? varying : orderedKeys(draft);
  let position = opts.startPosition ?? 0;
  return draft.variants.map((v, i) => {
    const variantId = ids[i]!;
    return {
      id: `${shop.slug}:${variantId}`,
      shopId: shop.slug,
      variantId,
      parentId,
      productName: draft.name,
      name: variantName(draft, v.attributes, nameKeys),
      category: draft.category,
      description: draft.description,
      url: storefrontUrl(base, shop.slug, parentId, variantId),
      priceCents: v.priceCents,
      costCents: v.costCents ?? 0,
      floorCents: v.floorCents,
      stock: v.stock,
      attributes: { ...v.attributes },
      flags: [...v.flags],
      purchasable: v.purchasable,
      leadTimeDays: v.leadTimeDays,
      weightG: v.weightG ?? 0,
      active: true,
      position: position++,
      ...(draft.market ? { market: { ...draft.market, priceCents: v.priceCents, position: positionOf(v.priceCents, draft.market) } } : {}),
    };
  });
}
