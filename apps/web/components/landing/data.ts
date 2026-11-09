import "server-only";

// Everything the landing page shows about the demo shop and the benchmarks is
// read here, at build time, from the files the product and the benchmarks
// write: the seed catalog, results/purchase.json, results/negotiation.json and
// the registered negotiation scenarios. Nothing below is typed in by hand
// except the scripted hero trips, which are checked against the catalog so a
// catalog change that breaks one fails the build instead of the page.

import { COUNTER_APPS, TOOL_NAMES } from "@counter/gateway";
import { SMALL_CART_MAX_PCT } from "@counter/negotiate";
import {
  DEFAULT_SHIPPING_OPTION,
  FREE_STANDARD_FROM_CENTS,
  addBusinessDays,
  fmt,
  quoteShipping,
  toCents,
  type Address,
} from "@counter/store-sync";
import catalogJson from "../../../../packages/db/src/seed/catalog.json";
import scenariosJson from "../../../../bench/negotiation/scenarios.json";
import negotiationJson from "../../../../results/negotiation.json";
import purchaseJson from "../../../../results/purchase.json";
import type { HeroData, HeroTrip, NegotiationRun, PurchaseArm, PurchaseModel, Variant, VariantFlag } from "./types";

// ---------------------------------------------------------------- catalog

interface CatalogVariant {
  variant_id: string;
  attributes: Record<string, string>;
  price: string;
  floor: string;
  stock: number;
  lead_time_days: number;
  flags: string[];
}
interface CatalogProduct {
  parent_id: string;
  name: string;
  variants: CatalogVariant[];
}
interface CatalogShop {
  slug: string;
  name: string;
  owner: string;
  policy: { handling_days: number; negotiation: { enabled: boolean; max_discount_pct: number; bundle_min_items: number } };
  products: CatalogProduct[];
}

const SHOPS = (catalogJson as unknown as { shops: CatalogShop[] }).shops;
const HERO_SHOP_SLUG = "juniper-clay";

function shopBySlug(slug: string): CatalogShop {
  const shop = SHOPS.find((s) => s.slug === slug);
  if (!shop) throw new Error(`landing: shop ${slug} is not in the seed catalog`);
  return shop;
}

const heroShop = shopBySlug(HERO_SHOP_SLUG);

const VARIANTS = new Map<string, { product: CatalogProduct; variant: CatalogVariant; shop: CatalogShop }>();
for (const shop of SHOPS) for (const product of shop.products) for (const variant of product.variants) VARIANTS.set(variant.variant_id, { product, variant, shop });

function catalogVariant(id: string) {
  const hit = VARIANTS.get(id);
  if (!hit) throw new Error(`landing: variant ${id} is not in the seed catalog`);
  return hit;
}

function flagOf(v: CatalogVariant): VariantFlag {
  if (v.flags.includes("seconds")) return "seconds";
  if (v.flags.includes("made_to_order")) return "made_to_order";
  return "";
}

function toVariant(product: CatalogProduct, v: CatalogVariant): Variant {
  return {
    id: v.variant_id,
    product: product.parent_id,
    glaze: v.attributes.glaze ?? "",
    size: v.attributes.size ?? v.attributes.set_size ?? "",
    price: v.price,
    stock: v.stock,
    flag: flagOf(v),
    lead: v.lead_time_days,
  };
}

/** Readable attribute values of a variant, in catalog order: "sage, 12 oz". */
function attrs(v: CatalogVariant): string {
  return Object.values(v.attributes).join(", ");
}

/** Business days of Standard shipping, read from the Cart API's own shipping quote. */
function standardTransitDays(): number {
  const monday = new Date(Date.UTC(2026, 0, 5));
  const quote = quoteShipping({ country_code: "US" } as Address, 0, monday).find((q) => q.id === DEFAULT_SHIPPING_OPTION);
  if (!quote) throw new Error("landing: no Standard shipping quote");
  for (let days = 1; days < 30; days++) if (addBusinessDays(monday, days) === quote.estimatedDelivery) return days;
  throw new Error("landing: could not read Standard transit days");
}

// ---------------------------------------------------------------- text repair

// A few benchmark strings were stored with UTF-8 read back as Windows-1251
// ("вЂ”" for "—"). Undo that where the whole string round-trips cleanly.
const CP1251 = (() => {
  const dec = new TextDecoder("windows-1251");
  const map = new Map<string, number>();
  for (let b = 0x80; b <= 0xff; b++) map.set(dec.decode(new Uint8Array([b])), b);
  return map;
})();

function repairText(s: string): string {
  if (!/[Ѐ-ӿ]/.test(s)) return s;
  const bytes: number[] = [];
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else {
      const b = CP1251.get(ch);
      if (b === undefined) return s;
      bytes.push(b);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------- negotiation

interface ScenarioLine {
  variant_id: string;
  quantity: number;
}
interface Scenario {
  id: string;
  category: string;
  shop: string;
  lines: ScenarioLine[];
  buyer_message: string;
}
interface RawProposal {
  engine_verdict: string;
  discount_pct: number;
  below_floor_lines: number;
}
interface EngineArm {
  verdict: string;
  unit_cents: number[];
  discount_pct: number;
  raw_proposals?: RawProposal[];
  reply: string;
}
interface NegotiationFile {
  config: { models: string[] };
  summary: {
    scenarios: number;
    runs: number;
    below_floor: { engine: number; control: number };
    rule_violations: { engine: number; control: number };
    mismatches: { final: number };
    spend_usd: number;
    by_model: Record<string, { offers_issued: number; offer_mismatches: number }>;
  };
  runs: Array<{ scenario: string; category: string; shop: string; model: string; engine: EngineArm }>;
}

const NEG = negotiationJson as unknown as NegotiationFile;
const SCENARIOS = new Map((scenariosJson as unknown as { scenarios: Scenario[] }).scenarios.map((s) => [s.id, s]));

function scenario(id: string): Scenario {
  const s = SCENARIOS.get(id);
  if (!s) throw new Error(`landing: scenario ${id} is not registered`);
  return s;
}

function stoppedSentence(p: RawProposal): string {
  if (p.below_floor_lines > 0) {
    const n = p.below_floor_lines;
    return `The seller first proposed ${p.discount_pct}% off, which would have priced ${n} line${n === 1 ? "" : "s"} below the floor. The engine clamped it.`;
  }
  return `The seller first proposed ${p.discount_pct}% off a single item, over the ${SMALL_CART_MAX_PCT}% cap for a cart that is not a bundle. The engine clamped it.`;
}

/** Cuts a reply at a word boundary so every exchange fits the panel. */
function excerpt(s: string, max = 230): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

const NEGOTIATION_RUNS: NegotiationRun[] = NEG.runs.map((run) => {
  const sc = scenario(run.scenario);
  const e = run.engine;
  const clamped = e.raw_proposals?.find((p) => p.engine_verdict === "clamped");
  return {
    scenario: run.scenario,
    category: run.category,
    shop: catalogVariant(sc.lines[0]!.variant_id).shop.name,
    model: NEG.config.models.indexOf(run.model),
    buyer: repairText(sc.buyer_message),
    reply: excerpt(repairText(e.reply)),
    lines: sc.lines.map((l, i) => {
      const { product, variant } = catalogVariant(l.variant_id);
      const unit = e.unit_cents[i];
      return { qty: l.quantity, product: product.name, attrs: attrs(variant), list: variant.price, unit: unit == null ? variant.price : fmt(unit) };
    }),
    discountPct: e.discount_pct,
    stopped: clamped ? stoppedSentence(clamped) : null,
  };
});

function negotiationRun(id: string, model: string): NegotiationRun {
  const i = NEG.config.models.indexOf(model);
  const run = NEGOTIATION_RUNS.find((r) => r.scenario === id && r.model === i);
  if (!run) throw new Error(`landing: no negotiation run ${id} for ${model}`);
  return run;
}

export const negotiation = {
  models: NEG.config.models,
  scenarios: NEG.summary.scenarios,
  runs: NEGOTIATION_RUNS,
  belowFloor: NEG.summary.below_floor.engine,
  ruleViolations: NEG.summary.rule_violations.engine,
  controlRuleViolations: NEG.summary.rule_violations.control,
  replyMismatches: NEG.summary.mismatches.final,
  offersIssued: Object.values(NEG.summary.by_model).reduce((n, m) => n + m.offers_issued, 0),
  offerMismatches: Object.values(NEG.summary.by_model).reduce((n, m) => n + m.offer_mismatches, 0),
  spendUsd: NEG.summary.spend_usd,
  categories: [...new Set(NEG.runs.map((r) => r.category))],
  /** The exchange the "How it works" haggle step quotes, and the one the field opens on. */
  featured: { scenario: "I01", model: "claude-haiku-5-5" },
};

/** The haggle step's exchange: a prompt injection, answered inside the rules. */
export const featuredExchange = (() => {
  const run = negotiationRun(negotiation.featured.scenario, negotiation.featured.model);
  const line = run.lines[0]!;
  const raw = NEG.runs.find((r) => r.scenario === run.scenario && r.model === negotiation.featured.model)!.engine;
  return {
    id: run.scenario,
    verdict: raw.verdict,
    model: negotiation.featured.model,
    buyer: run.buyer,
    reply: repairText(raw.reply).trim(),
    unit: line.unit,
    list: line.list,
  };
})();

// ---------------------------------------------------------------- purchase benchmark

interface PurchaseRun {
  task: string;
  model: string;
  arm: "storefront" | "counter";
  steps: number;
  verdict: string;
  total: string | null;
  expected_lines: ScenarioLine[];
}
interface PurchaseSummary {
  model: string;
  arm: "storefront" | "counter";
  runs: number;
  correct: number;
  wrong_buys: number;
  missed_buys: number;
  median_steps: number;
  cost_usd: number;
}
const PURCHASE = purchaseJson as unknown as { environment: { temperature: number }; summary: PurchaseSummary[]; runs: PurchaseRun[] };

const MODEL_LABELS: Record<string, string> = { "openai-gpt-6-sol": "Larger model", "z-ai-glm-5-3-flash": "Small model" };

function arm(model: string, which: "storefront" | "counter"): PurchaseArm {
  const s = PURCHASE.summary.find((x) => x.model === model && x.arm === which);
  if (!s) throw new Error(`landing: no purchase summary for ${model} ${which}`);
  const runs = PURCHASE.runs.filter((r) => r.model === model && r.arm === which).sort((a, b) => a.task.localeCompare(b.task));
  return {
    runs: s.runs,
    correct: s.correct,
    wrongBuys: s.wrong_buys,
    missedBuys: s.missed_buys,
    medianSteps: s.median_steps,
    costUsd: s.cost_usd,
    steps: runs.map((r) => r.steps),
    correctByTask: runs.map((r) => r.verdict.startsWith("CORRECT")),
  };
}

const PURCHASE_MODELS = [...new Set(PURCHASE.summary.map((s) => s.model))];

export const purchase: { models: PurchaseModel[]; callsRatio: number; costRatio: number; tasks: number; runs: number; temperature: number } = (() => {
  const models = PURCHASE_MODELS.map((id) => ({ id, label: MODEL_LABELS[id] ?? id, storefront: arm(id, "storefront"), counter: arm(id, "counter") }));
  // The headline compares the larger model's arms, as the README does.
  const lead = models[0]!;
  return {
    models,
    callsRatio: Math.round(lead.storefront.medianSteps / lead.counter.medianSteps),
    costRatio: Math.round(lead.storefront.costUsd / lead.counter.costUsd),
    tasks: lead.storefront.runs,
    runs: PURCHASE.summary.reduce((n, s) => n + s.runs, 0),
    temperature: PURCHASE.environment.temperature,
  };
})();

/** Task T01's cart, priced the way the Cart API priced it: the "Open the cart" step. */
export const sampleCart = (() => {
  const run = PURCHASE.runs.find((r) => r.task === "T01" && r.total);
  if (!run) throw new Error("landing: task T01 has no priced run");
  const line = run.expected_lines[0]!;
  const { variant } = catalogVariant(line.variant_id);
  const subtotal = toCents(variant.price) * line.quantity;
  const shipping = subtotal >= FREE_STANDARD_FROM_CENTS ? 0 : quoteShipping({ country_code: "US" } as Address, subtotal, new Date(Date.UTC(2026, 0, 5)))[0]!.priceCents;
  const total = toCents(run.total!);
  return {
    variantId: line.variant_id,
    quantity: line.quantity,
    subtotal: fmt(subtotal),
    shipping: fmt(shipping),
    tax: fmt(total - subtotal - shipping),
    total: fmt(total),
  };
})();

// ---------------------------------------------------------------- the hero

const P03 = negotiationRun("P03", "claude-haiku-5-5");
const p03Line = scenario("P03").lines[0]!;

/** Scripted trips on the real catalog. Agent names are Store Sync Client_Identifier values plus an MCP client. */
const TRIPS: HeroTrip[] = [
  {
    agent: "Perplexity",
    side: "L",
    lane: 0,
    sku: p03Line.variant_id,
    ask: "Three 12 oz speckled mugs in ink. 10% off for three?",
    per: " each",
    deal: { unit: P03.lines[0]!.unit, qty: p03Line.quantity },
  },
  { agent: "Meta AI", side: "R", lane: 0, sku: "JC-PLATE-DINNER-OAT-PAIR", ask: "A pair of oat dinner plates.", per: " for the pair" },
  {
    agent: "Copilot",
    side: "L",
    lane: 1,
    sku: "JC-MUG-SPECKLE-INK-16",
    ask: "A 16 oz speckled mug in ink.",
    honest: { alts: ["JC-MUG-SPECKLE-SECONDS-INK-16", "JC-MUG-SPECKLE-RUST-16"], pick: "JC-MUG-SPECKLE-RUST-16" },
  },
  { agent: "MCP client", side: "R", lane: 1, sku: "JC-BOWL-SERVING-RUST", ask: "The large serving bowl, rust glaze." },
];

function checkTrips(trips: HeroTrip[]): HeroTrip[] {
  for (const t of trips) {
    const { variant, shop } = catalogVariant(t.sku);
    if (shop.slug !== HERO_SHOP_SLUG) throw new Error(`landing: ${t.agent}'s trip leaves ${HERO_SHOP_SLUG}`);
    if (t.honest) {
      if (variant.stock !== 0) throw new Error(`landing: ${t.sku} is meant to be sold out`);
      for (const alt of t.honest.alts) if (catalogVariant(alt).variant.stock <= 0) throw new Error(`landing: ${alt} is meant to be in stock`);
      if (!t.honest.alts.includes(t.honest.pick)) throw new Error("landing: the buyer must pick one of the offered variants");
    } else if (variant.stock <= 0) throw new Error(`landing: ${t.sku} is meant to be in stock`);
    if (t.deal) {
      const unit = toCents(t.deal.unit);
      if (unit >= toCents(variant.price) || unit < toCents(variant.floor)) throw new Error(`landing: ${t.agent}'s deal is outside the shop's rules`);
    }
  }
  return trips;
}

export const hero: HeroData = {
  shop: heroShop.name,
  shipper: heroShop.owner.split(" ")[0]!,
  variants: heroShop.products.flatMap((p) => p.variants.map((v) => toVariant(p, v))),
  names: Object.fromEntries(heroShop.products.map((p) => [p.parent_id, p.name])),
  handlingDays: heroShop.policy.handling_days,
  transitDays: standardTransitDays(),
  trips: checkTrips(TRIPS),
};

// ---------------------------------------------------------------- other facts

/** Step 1's search excerpt: the sold-out mug and the two 16 oz mugs still in stock. */
export const searchExcerpt = ["JC-MUG-SPECKLE-INK-16", "JC-MUG-SPECKLE-SECONDS-INK-16", "JC-MUG-SPECKLE-RUST-16"].map((id) => {
  const { product, variant } = catalogVariant(id);
  return { ...toVariant(product, variant), name: product.name, attrs: attrs(variant) };
});

/** The floor diagram: one variant's list price and floor, and the shop's discount rules. */
export const floorExample = (() => {
  const { variant, product } = catalogVariant("JC-MUG-SPECKLE-SAGE-12");
  const list = toCents(variant.price);
  const n = heroShop.policy.negotiation;
  return {
    name: `${product.name}, ${attrs(variant)}`,
    list: fmt(list),
    floor: variant.floor,
    singleBest: fmt(Math.round((list * (100 - SMALL_CART_MAX_PCT)) / 100)),
    smallCartPct: SMALL_CART_MAX_PCT,
    capPct: n.max_discount_pct,
    bundleMin: n.bundle_min_items,
  };
})();

export const catalogTotals = {
  shops: SHOPS.length,
  variants: VARIANTS.size,
  heroVariants: hero.variants.length,
};

/** The MCP surface: the gateway's tools (negotiate is offered when the shop has a seller agent, as every demo shop does) and its MCP Apps cards. */
export const mcpSurface = {
  tools: [...TOOL_NAMES.slice(0, 3), "negotiate", ...TOOL_NAMES.slice(3)],
  cards: Object.values(COUNTER_APPS).map((a) => a.uri),
};
