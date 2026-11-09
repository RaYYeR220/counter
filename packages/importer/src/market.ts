import type { C3Product } from "./channel3/port";
import { resolved, type ImportDeps } from "./deps";
import { varyingKeys } from "./rows";
import { cleanUrl, hostOf, toCents } from "./text";
import { positionOf, priceStats } from "./stats";
import type { MarketCheck, ProductDraft, VariantDraft } from "./types";

export { positionOf, priceStats };

/** The variant with the median price (the lower one of two), standing in for the product. */
export function referenceVariant(draft: ProductDraft): VariantDraft | undefined {
  const priced = draft.variants.filter((v) => v.priceCents > 0).sort((a, b) => a.priceCents - b.priceCents);
  return priced[Math.floor((priced.length - 1) / 2)] ?? draft.variants[0];
}

const UNIT = /(\d+(?:\.\d+)?)\s*-?\s*(fl\.?\s*oz|oz|ml|cl|l|g|kg|lbs?|in|inch|inches|cm|mm|qt|gal)\b/gi;

function measures(text: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const m of text.matchAll(UNIT)) {
    let unit = m[2]!.toLowerCase().replace(/[\s.]/g, "");
    if (unit === "floz") unit = "oz";
    if (unit === "inch" || unit === "inches") unit = "in";
    if (unit === "lbs") unit = "lb";
    if (!out.has(unit)) out.set(unit, new Set());
    out.get(unit)!.add(Number(m[1]));
  }
  return out;
}

const SET = /\b(sets?|bundle|pack of \d+|\d+\s*-?\s*(pack|pc|pcs|piece|pieces|count))\b/i;

function singular(word: string): string {
  return word.replace(/(ies)$/, "y").replace(/(ches|shes|sses|xes)$/, (m) => m.slice(0, -2)).replace(/(?<!s)s$/, "");
}

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]+/g) ?? []).map(singular));
}

/** Product nouns a comparable's title must mention: the last word of the name and the category. */
function headNouns(draft: ProductDraft): string[] {
  const nameWords = draft.name.toLowerCase().match(/[a-z]+/g) ?? [];
  const nouns = [nameWords.at(-1), ...(draft.category.toLowerCase().match(/[a-z]+/g) ?? [])]
    .filter((w): w is string => Boolean(w && w.length >= 3))
    .map(singular);
  return [...new Set(nouns)];
}

/**
 * Search text: the name, the reference variant's sizes, and the first
 * attribute every variant shares (usually the material). More shared
 * attributes would turn the search into a filter list.
 */
function searchText(draft: ProductDraft, ref: VariantDraft | undefined): string {
  const varying = new Set(varyingKeys(draft));
  const entries = Object.entries(ref?.attributes ?? {});
  const order = (k: string) => (draft.attributesOrder.includes(k) ? draft.attributesOrder.indexOf(k) : Number.MAX_SAFE_INTEGER);
  const sizes = entries.filter(([, v]) => /\d/.test(v)).map(([, v]) => v);
  const shared = entries
    .filter(([k, v]) => !varying.has(k) && !/\d/.test(v))
    .sort((a, b) => order(a[0]) - order(b[0]))
    .slice(0, 1)
    .map(([, v]) => v);
  return [draft.name, ...sizes, ...shared].join(" ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Channel3 search by the product's name and key attributes, keeping only
 * products that are plainly the same kind of thing: the title must name the
 * product noun, must not state a different size in the same unit, and must
 * not be a set or multipack unless ours is. Each comparable is priced at its
 * cheapest in-stock offer in the draft's currency, leaving out the shop's own
 * site. Undefined when nothing comparable is found.
 */
export async function marketCheck(
  draft: ProductDraft,
  deps: Pick<ImportDeps, "channel3" | "now">,
  opts: {
    currency?: string;
    limit?: number;
    /** Overrides the search text built from the draft. */
    query?: string;
    /** A product photo, searched with when Channel3 takes images. */
    imageBase64?: string;
  } = {},
): Promise<MarketCheck | undefined> {
  const { now } = resolved(deps);
  const currency = opts.currency ?? "USD";
  const ref = referenceVariant(draft);
  const query = opts.query?.trim() || searchText(draft, ref);
  const image = opts.imageBase64 && deps.channel3.imageSearch ? { imageBase64: opts.imageBase64 } : {};
  const products = await deps.channel3.search({ query, limit: 20, ...image });

  const ownHost = draft.source.kind === "url" ? draft.source.merchant || hostOf(draft.source.ref ?? "") : "";
  const nouns = headNouns(draft);
  const ours = measures(Object.values(ref?.attributes ?? {}).join(" ") + " " + draft.name);
  const oursIsSet = SET.test(`${draft.name} ${Object.values(ref?.attributes ?? {}).join(" ")}`);

  const comparable: MarketCheck["comparable"] = [];
  for (const product of products) {
    if (!isComparable(product, nouns, ours, oursIsSet)) continue;
    const best = cheapestOffer(product, currency, ownHost);
    if (!best) continue;
    comparable.push({ title: product.title, merchant: best.domain, priceCents: toCents(best.price.price), url: safeUrl(best.url) });
    if (comparable.length >= (opts.limit ?? 8)) break;
  }
  if (!comparable.length) return undefined;

  const stats = priceStats(comparable.map((c) => c.priceCents));
  const priceCents = ref?.priceCents ?? 0;
  return {
    comparable,
    ...stats,
    position: positionOf(priceCents, stats),
    priceCents,
    checkedAt: now().toISOString(),
  };
}

function isComparable(product: C3Product, nouns: string[], ours: Map<string, Set<number>>, oursIsSet: boolean): boolean {
  const title = product.title ?? "";
  const titleWords = words(title);
  if (nouns.length && !nouns.some((n) => titleWords.has(n))) return false;
  if (!oursIsSet && SET.test(title)) return false;
  for (const [unit, values] of measures(title)) {
    const mine = ours.get(unit);
    if (mine && ![...values].some((x) => mine.has(x))) return false;
  }
  return true;
}

function cheapestOffer(product: C3Product, currency: string, ownHost: string) {
  return (product.offers ?? [])
    .filter((o) => o.price?.currency === currency && o.price.price > 0)
    .filter((o) => (o.availability ?? "InStock") === "InStock")
    .filter((o) => !ownHost || hostOf(`https://${o.domain}`) !== ownHost)
    .sort((a, b) => a.price.price - b.price.price)[0];
}

function safeUrl(url: string): string {
  try {
    return cleanUrl(url);
  } catch {
    return "";
  }
}
