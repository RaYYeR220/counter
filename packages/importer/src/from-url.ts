import { Channel3Error, type C3Measure, type C3Offer, type C3Product } from "./channel3/port";
import { ImportError, resolved, type ImportDeps } from "./deps";
import { suggestFloor } from "./floor";
import { askJson } from "./llm";
import { assignVariantIds } from "./rows";
import { attributeKey, cleanUrl, hostOf, keepSupportedSentences, sentences, slug, toCents } from "./text";
import type { ProductDraft, VariantDraft } from "./types";

/** More combinations than this are cut, with a warning. */
const MAX_VARIANTS = 60;
const MAX_ATTRIBUTES = 5;

/** An attribute the source states: an option with its values, or a fixed fact. */
interface Candidate {
  source: string;
  values: string[];
  /** A buyer picks one of `values`; every variant has one. */
  option: boolean;
}

const SYSTEM = `You prepare product listings for a small shop's catalog. AI shopping agents read these listings and rely on them, so accuracy matters more than style.
You get one product's source data as JSON. Reply with one JSON object only:
{"attributes":[{"source":"<an option name or structured attribute key from the data>","name":"<short snake_case name a buyer would use>"}],"description":"<2 to 4 plain sentences>"}
attributes: what a buyer chooses between or filters on, most important first. Always include every option with more than one value. Use only sources that appear in the data. At most ${MAX_ATTRIBUTES}.
description: plain and specific: what the product is, its material, its size or capacity, and how to care for it, when the data says so. Use only facts stated in the data. Never add a number, measurement, material, origin or claim the data does not state. Do not describe one option (such as one colour) as if it were the whole product. Do not state the price, stock or a list of the options: the listing shows those. No marketing language, no superlatives, no emoji.`;

/**
 * A draft from a product page URL. Channel3 resolves the page; options,
 * prices and facts are mapped as they are. The model only picks and names
 * the attributes buyers choose between and writes the description, and any
 * description sentence with a number the source does not state is dropped.
 * Stock is never on a product page, so it starts at 0 with a warning.
 */
export async function fromUrl(url: string, deps: ImportDeps): Promise<ProductDraft> {
  const { models, policy } = resolved(deps);
  let page: string;
  try {
    page = cleanUrl(url);
  } catch (err) {
    throw new ImportError(err instanceof Error ? err.message : String(err), "invalid_input");
  }

  let product: C3Product | null;
  try {
    product = await deps.channel3.lookup(page);
  } catch (err) {
    if (err instanceof Channel3Error && err.code === "not_a_product_page") {
      throw new ImportError("That page is not a product page Channel3 can read. Paste the URL of a single product.", "not_a_product_page");
    }
    throw err;
  }
  if (!product) throw new ImportError(`Channel3 could not find a product at ${page}`, "not_found");

  const warnings: string[] = [];
  const host = hostOf(page);
  if (isThin(product)) product = await enrich(product, host, deps);

  // Price: the page's own offer. A Channel3 link stands for the retailer it
  // points to; any other mismatch means the price is someone else's.
  const viaChannel3 = host.endsWith("trychannel3.com");
  const offer = product.offers?.find((o) => hostOf(`https://${o.domain}`) === host) ?? product.offers?.[0];
  const offerHost = offer ? hostOf(`https://${offer.domain}`) : "";
  const merchant = viaChannel3 ? offerHost : host;
  let priceCents = 0;
  if (!offer) warnings.push("The page shows no price: set a price before publishing.");
  else if (offer.price.currency !== "USD") {
    warnings.push(`The page is priced in ${offer.price.currency}: set a price in USD before publishing.`);
  } else {
    priceCents = toCents(offer.price.price);
    if (offerHost !== merchant) warnings.push(`The price comes from ${offerHost}, not from this page: check it.`);
  }

  const candidates = candidatesOf(product);
  const facts = factsOf(product, offer);
  const factsText = JSON.stringify(facts);

  let picked: Array<{ candidate: Candidate; name: string }>;
  let description: string;
  try {
    const reply = await askJson(deps.llm, {
      model: models.text,
      system: SYSTEM,
      user: `Source data:\n${JSON.stringify(facts, null, 1)}`,
      maxTokens: 900,
    });
    picked = pickAttributes(reply.attributes, candidates);
    const written = typeof reply.description === "string" ? reply.description.trim() : "";
    const checked = keepSupportedSentences(written, factsText);
    if (checked.dropped.length) {
      warnings.push(`Left out of the description because the source does not say so: ${checked.dropped.join(" ")}`);
    }
    description = checked.text || fallbackDescription(product);
    if (!checked.text) warnings.push("The description is the source text as found: review it.");
  } catch {
    picked = pickAttributes([], candidates);
    description = fallbackDescription(product);
    warnings.push("The description is the source text as found: review it.");
  }

  const combos = combinations(picked);
  if (combos.truncated) warnings.push(`The page lists more than ${MAX_VARIANTS} combinations; only the first ${MAX_VARIANTS} were kept.`);
  const weightG = weightGrams(offer?.dimensions?.weight);

  const variants: VariantDraft[] = combos.list.map((attributes) => {
    const v: VariantDraft = {
      variantId: "",
      attributes,
      priceCents,
      stock: 0,
      floorCents: 0,
      flags: [],
      purchasable: true,
      leadTimeDays: 0,
      ...(weightG ? { weightG } : {}),
    };
    v.floorCents = suggestFloor(v, undefined, policy);
    return v;
  });

  warnings.push("Stock is unknown: set stock before publishing.");
  if (variants.length > 1 && priceCents > 0) {
    warnings.push(`Every variant uses the page price of $${(priceCents / 100).toFixed(2)}: change any that cost more or less.`);
  }

  const draft: ProductDraft = {
    parentId: slug(product.title.replace(/^(the|a|an)\s+/i, ""), 32) || "ITEM",
    name: product.title.trim(),
    category: product.category?.slug ?? "general",
    description,
    attributesOrder: picked.map((p) => p.name),
    variants,
    source: { kind: "url", ref: page, ...(merchant ? { merchant } : {}) },
    warnings,
  };
  assignVariantIds(draft, "").forEach((id, i) => (draft.variants[i]!.variantId = id));
  return draft;
}

/** A page lookup with options and price but no description or attributes. */
function isThin(p: C3Product): boolean {
  return !p.description?.trim() && !p.key_features?.length && !Object.keys(p.structured_attributes ?? {}).length;
}

function sameTitle(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * Channel3's catalog entry for the same product, whose description and
 * attributes fill the gaps: by the lookup's own id first, else the search
 * result with the same title sold on the same site. Options and offers stay
 * as the page lookup gave them.
 */
async function enrich(product: C3Product, host: string, deps: ImportDeps): Promise<C3Product> {
  try {
    let [full] = await deps.channel3.products([product.id]);
    if (!full || isThin(full)) {
      const brand = product.brands?.[0]?.name ?? host;
      const found = await deps.channel3.search({ query: `${product.title} ${brand}`.trim(), limit: 8 });
      const match = found.find(
        (p) => p.id !== product.id && sameTitle(p.title, product.title) && (p.offers ?? []).some((o) => hostOf(`https://${o.domain}`) === host),
      );
      if (!match) return product;
      [full] = await deps.channel3.products([match.id]);
    }
    if (!full || isThin(full)) return product;
    return {
      ...product,
      description: product.description || full.description,
      brands: product.brands?.length ? product.brands : full.brands,
      category: product.category ?? full.category,
      materials: product.materials?.length ? product.materials : full.materials,
      key_features: product.key_features?.length ? product.key_features : full.key_features,
      structured_attributes: { ...full.structured_attributes, ...product.structured_attributes },
    };
  } catch {
    return product;
  }
}

function candidatesOf(p: C3Product): Candidate[] {
  const out: Candidate[] = [];
  for (const o of p.variants?.options ?? []) {
    const values = [...new Set(o.values.filter((v) => v.exists !== false).map((v) => v.label.trim()).filter(Boolean))];
    if (values.length) out.push({ source: o.name, values, option: true });
  }
  if (!out.length) {
    for (const s of p.variants?.selected ?? []) out.push({ source: s.name, values: [s.label], option: false });
  }
  for (const [key, values] of Object.entries(p.structured_attributes ?? {})) {
    if (!out.some((c) => c.source === key) && values.length) out.push({ source: key, values, option: false });
  }
  return out;
}

/** The model's attribute picks, checked against the source; every option buyers choose is kept. */
function pickAttributes(raw: unknown, candidates: Candidate[]): Array<{ candidate: Candidate; name: string }> {
  const picked: Array<{ candidate: Candidate; name: string }> = [];
  const add = (candidate: Candidate, name: string) => {
    const key = attributeKey(name).slice(0, 32) || attributeKey(candidate.source);
    if (!key || picked.some((p) => p.candidate === candidate || p.name === key)) return;
    picked.push({ candidate, name: key });
  };
  for (const item of Array.isArray(raw) ? raw : []) {
    const source = typeof item === "object" && item ? (item as { source?: unknown }).source : undefined;
    const name = typeof item === "object" && item ? (item as { name?: unknown }).name : undefined;
    const candidate = candidates.find((c) => c.source === source);
    if (candidate) add(candidate, typeof name === "string" ? name : candidate.source);
  }
  for (const c of candidates) if (c.option && c.values.length > 1) add(c, c.source);
  // Options first would reorder the model's choice; only trim from the end, never dropping an option.
  while (picked.length > MAX_ATTRIBUTES) {
    const i = picked.findLastIndex((p) => !p.candidate.option);
    if (i < 0) break;
    picked.splice(i, 1);
  }
  return picked;
}

function combinations(picked: Array<{ candidate: Candidate; name: string }>): { list: Array<Record<string, string>>; truncated: boolean } {
  let list: Array<Record<string, string>> = [{}];
  let truncated = false;
  for (const { candidate, name } of picked) {
    const values = candidate.option ? candidate.values : [candidate.values.join(", ")];
    const next: Array<Record<string, string>> = [];
    for (const base of list) for (const value of values) next.push({ ...base, [name]: value });
    if (next.length > MAX_VARIANTS) truncated = true;
    list = next.slice(0, MAX_VARIANTS);
  }
  return { list, truncated };
}

/** Everything the source states, as the model sees it and as numbers are checked against. */
function factsOf(p: C3Product, offer: C3Offer | undefined) {
  const dims = offer?.dimensions;
  const dimensions = dims
    ? Object.fromEntries(
        Object.entries(dims)
          .filter((e): e is [string, C3Measure] => Boolean(e[1]))
          .map(([k, m]) => [k, `${m.number} ${m.unit}`]),
      )
    : undefined;
  return {
    title: p.title,
    brand: p.brands?.[0]?.name,
    category: p.category?.title,
    description: p.description ?? undefined,
    materials: p.materials ?? undefined,
    key_features: p.key_features ?? undefined,
    options: Object.fromEntries((p.variants?.options ?? []).map((o) => [o.name, o.values.filter((v) => v.exists !== false).map((v) => v.label)])),
    structured_attributes: p.structured_attributes ?? undefined,
    dimensions: dimensions && Object.keys(dimensions).length ? dimensions : undefined,
    price: offer ? `${offer.price.price} ${offer.price.currency}` : undefined,
  };
}

function fallbackDescription(p: C3Product): string {
  const own = sentences(p.description ?? "").slice(0, 4).join(" ");
  if (own) return own.slice(0, 600);
  const parts = [...(p.materials ?? []).slice(0, 2), ...(p.key_features ?? []).slice(0, 4)];
  return parts.length ? `${p.title}. ${parts.join(". ")}.` : `${p.title}.`;
}

function weightGrams(m: C3Measure | null | undefined): number | undefined {
  if (!m || !(m.number > 0)) return undefined;
  const factor: Record<string, number> = { g: 1, kg: 1000, lb: 453.592, lbs: 453.592, oz: 28.3495 };
  const f = factor[m.unit.toLowerCase()];
  return f ? Math.round(m.number * f) : undefined;
}
