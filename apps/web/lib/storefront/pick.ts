import type { ArtSubject, ProductView, VariantView } from "./types";

export function sellable(v: VariantView): boolean {
  return v.active && v.purchasable && v.stock > 0;
}

/** The variant a product is shown with by default: the first one that can be bought, else the first. */
export function defaultVariant(p: ProductView): VariantView {
  return p.variants.find(sellable) ?? p.variants.find((v) => v.active && v.stock > 0) ?? p.variants[0]!;
}

export function artSubject(p: ProductView, v: VariantView): ArtSubject {
  return { category: p.category, parentId: p.parentId, productName: p.name, attributes: v.attributes, flags: v.flags };
}

/** Up to three products for the shop's intro picture, one per category first, in varied colors. */
export function heroSubjects(products: ProductView[], count = 3): ArtSubject[] {
  const picked: ProductView[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    if (picked.length < count && !seen.has(p.category)) {
      picked.push(p);
      seen.add(p.category);
    }
  }
  for (const p of products) if (picked.length < count && !picked.includes(p)) picked.push(p);

  const usedLooks = new Set<string>();
  return picked.map((p) => {
    const key = p.attributeOrder[0];
    const options = p.variants.filter(sellable);
    const fresh = key ? options.find((v) => !usedLooks.has(v.attributes[key] ?? "")) : undefined;
    const v = fresh ?? defaultVariant(p);
    if (key) usedLooks.add(v.attributes[key] ?? "");
    return artSubject(p, v);
  });
}

export function productHref(shop: string, parentId: string, variantId?: string): string {
  const base = `/s/${encodeURIComponent(shop)}/p/${encodeURIComponent(parentId)}`;
  return variantId ? `${base}?v=${encodeURIComponent(variantId)}` : base;
}
