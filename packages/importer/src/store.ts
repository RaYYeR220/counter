import { getShop, logEvent, variants, type Db, type NewVariant, type Variant } from "@counter/db";
import { and, eq, getTableColumns, inArray, max, sql, type SQL } from "drizzle-orm";
import type { ImportDeps } from "./deps";
import { marketCheck } from "./market";
import { toVariantRows } from "./rows";
import { positionOf } from "./stats";
import type { MarketCheck, ProductDraft } from "./types";

export class PublishError extends Error {
  override readonly name = "PublishError";

  constructor(
    message: string,
    readonly code: "shop_not_found" | "invalid_draft",
    readonly problems: string[] = [],
  ) {
    super(message);
  }
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

/** Everything that stops a draft from being sold as it stands, one line per problem. */
export function draftProblems(draft: ProductDraft): string[] {
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push("A product has no name.");
  if (!draft.variants.length) problems.push(`${draft.name}: no variants.`);
  for (const v of draft.variants) {
    const values = Object.values(v.attributes).filter(Boolean);
    const label = values.length ? `${draft.name} — ${values.join(", ")}` : draft.name;
    if (!Number.isInteger(v.priceCents) || v.priceCents <= 0) problems.push(`${label}: set a price above $0.`);
    else if (!isCount(v.floorCents) || v.floorCents > v.priceCents) {
      problems.push(`${label}: the floor (${money(v.floorCents)}) must be between $0 and the price (${money(v.priceCents)}).`);
    }
    if (!isCount(v.stock)) problems.push(`${label}: stock must be a whole number, 0 or more.`);
    if (!isCount(v.leadTimeDays)) problems.push(`${label}: lead time must be a whole number of days.`);
    if (v.costCents !== undefined && !isCount(v.costCents)) problems.push(`${label}: cost must be 0 or more.`);
  }
  return problems;
}

/** `ON CONFLICT ... DO UPDATE SET` taking the listed columns from the incoming row. */
function fromExcluded(keys: readonly (keyof NewVariant & string)[]): Record<string, SQL> {
  const columns = getTableColumns(variants) as Record<string, { name: string }>;
  return Object.fromEntries(keys.map((k) => [k, sql.raw(`excluded."${columns[k]!.name}"`)]));
}

export interface PublishResult {
  products: number;
  variants: number;
  created: number;
  updated: number;
  variantIds: string[];
}

/**
 * Writes reviewed drafts into the shop's catalog. New products go after
 * the existing ones; a product published again keeps its place and its
 * market data unless the draft brings a newer check. Logs `catalog.published`.
 */
export async function publishDrafts(
  db: Db,
  shopSlug: string,
  drafts: ProductDraft[],
  opts: { publicBaseUrl?: string } = {},
): Promise<PublishResult> {
  const shop = await getShop(db, shopSlug);
  if (!shop) throw new PublishError(`No shop called ${shopSlug}`, "shop_not_found");
  const problems = drafts.flatMap(draftProblems);
  if (problems.length) throw new PublishError("Some drafts are not ready to publish", "invalid_draft", problems);

  const [{ last } = { last: null }] = await db
    .select({ last: max(variants.position) })
    .from(variants)
    .where(eq(variants.shopId, shop.id));
  let position = last === null ? 0 : last + 1;
  const taken = new Set<string>();
  const rows: NewVariant[] = [];
  for (const d of drafts) {
    const r = toVariantRows(d, shop, { ...(opts.publicBaseUrl ? { publicBaseUrl: opts.publicBaseUrl } : {}), startPosition: position, taken });
    position += r.length;
    rows.push(...r);
  }
  if (!rows.length) return { products: 0, variants: 0, created: 0, updated: 0, variantIds: [] };

  const variantIds = rows.map((r) => r.variantId);
  const existing = await db
    .select({ variantId: variants.variantId })
    .from(variants)
    .where(and(eq(variants.shopId, shop.id), inArray(variants.variantId, variantIds)));

  await db
    .insert(variants)
    .values(rows)
    .onConflictDoUpdate({
      target: variants.id,
      set: {
        ...fromExcluded([
          "parentId",
          "productName",
          "name",
          "category",
          "description",
          "url",
          "priceCents",
          "costCents",
          "floorCents",
          "stock",
          "attributes",
          "flags",
          "purchasable",
          "leadTimeDays",
          "weightG",
          "active",
        ]),
        market: sql.raw(`coalesce(excluded."market", "variants"."market")`),
      },
    });

  const result: PublishResult = {
    products: drafts.length,
    variants: rows.length,
    created: rows.length - existing.length,
    updated: existing.length,
    variantIds,
  };
  await logEvent(db, shop.id, "catalog.published", drafts.length === 1 ? (rows[0]!.parentId ?? null) : null, {
    products: result.products,
    variants: result.variants,
    created: result.created,
    updated: result.updated,
    sources: [...new Set(drafts.map((d) => d.source.kind))],
    variant_ids: variantIds.slice(0, 100),
  });
  return result;
}

export interface MarketRefresh {
  /** Variants found and checked. */
  checked: number;
  /** Variants whose market data was replaced. */
  updated: number;
  /** Requested ids the shop does not have. */
  missing: string[];
  /** Checked variants with no comparable products; their market data is unchanged. */
  noComparables: string[];
}

/** A product draft standing in for catalog rows of one parent, for the market search. */
function draftFromRows(rows: Variant[]): ProductDraft {
  const first = rows[0]!;
  return {
    parentId: first.parentId,
    name: first.productName,
    category: first.category,
    description: first.description,
    attributesOrder: Object.keys(first.attributes),
    variants: rows.map((r) => ({
      variantId: r.variantId,
      attributes: r.attributes,
      priceCents: r.priceCents,
      stock: r.stock,
      floorCents: r.floorCents,
      flags: r.flags,
      purchasable: r.purchasable,
      leadTimeDays: r.leadTimeDays,
    })),
    source: { kind: "url", ref: first.url },
    warnings: [],
  };
}

/**
 * Re-runs the market check for the given variants, one Channel3 search per
 * product, and stores the result on each variant with its own position.
 */
export async function refreshMarket(
  db: Db,
  shopSlug: string,
  variantIds: string[],
  deps: Pick<ImportDeps, "channel3" | "now">,
): Promise<MarketRefresh> {
  const ids = [...new Set(variantIds)];
  const found = ids.length
    ? await db
        .select()
        .from(variants)
        .where(and(eq(variants.shopId, shopSlug), inArray(variants.variantId, ids)))
    : [];
  const byParent = new Map<string, Variant[]>();
  for (const r of found) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);

  const out: MarketRefresh = {
    checked: found.length,
    updated: 0,
    missing: ids.filter((id) => !found.some((r) => r.variantId === id)),
    noComparables: [],
  };
  for (const rows of byParent.values()) {
    const market = await marketCheck(draftFromRows(rows), deps);
    if (!market) {
      out.noComparables.push(...rows.map((r) => r.variantId));
      continue;
    }
    for (const r of rows) {
      const own: MarketCheck = { ...market, priceCents: r.priceCents, position: positionOf(r.priceCents, market) };
      await db.update(variants).set({ market: own }).where(eq(variants.id, r.id));
      out.updated++;
    }
  }
  return out;
}
