import { parseCsv } from "./csv";
import { ImportError, resolved, type ImportDeps } from "./deps";
import { suggestFloor } from "./floor";
import { askJson } from "./llm";
import { assignVariantIds } from "./rows";
import { attributeKey, parseMoneyCents, slug } from "./text";
import type { ProductDraft, VariantDraft } from "./types";

const FIELDS = [
  "sku",
  "parent",
  "name",
  "category",
  "description",
  "price",
  "stock",
  "cost",
  "floor",
  "weight_g",
  "lead_time_days",
  "flags",
  "purchasable",
] as const;
type Field = (typeof FIELDS)[number];

/** Header spellings read without the model, after lowercasing and turning punctuation into spaces. */
const ALIASES: Record<string, Field> = Object.fromEntries(
  (
    [
      ["sku", ["sku", "variant sku", "variant id", "variant_id", "id"]],
      ["parent", ["parent", "parent id", "parent_id", "handle", "product id", "product_id", "group", "style"]],
      ["name", ["name", "title", "product", "product name", "product title", "item", "item name"]],
      ["category", ["category", "type", "product type", "product category", "collection"]],
      ["description", ["description", "body", "body html", "details", "product description"]],
      ["price", ["price", "variant price", "unit price", "list price", "price usd"]],
      ["stock", ["stock", "qty", "quantity", "inventory", "inventory qty", "variant inventory qty", "on hand", "qty on hand", "stock qty"]],
      ["cost", ["cost", "unit cost", "cost per item", "variant cost", "cogs"]],
      ["floor", ["floor", "floor price", "min price", "minimum price"]],
      ["weight_g", ["weight g", "weight_g", "grams", "variant grams", "weight grams", "weight"]],
      ["lead_time_days", ["lead time", "lead time days", "lead_time_days"]],
      ["flags", ["flags"]],
      ["purchasable", ["purchasable"]],
    ] as Array<[Field, string[]]>
  ).flatMap(([field, names]) => names.map((n) => [n, field])),
);

const OPTION_NAME = /^option\s*([1-3])\s*name$/;
const OPTION_VALUE = /^option\s*([1-3])\s*value$/;

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9_]+/g, " ").trim();
}

/** A header a person would write for an attribute: a few plain words. */
function isPlainHeader(h: string): boolean {
  return /^[A-Za-z][A-Za-z _-]{0,30}$/.test(h.trim()) && h.trim().split(/\s+/).length <= 3 && !/^option\s*\d/i.test(h.trim());
}

/** How each column is read. */
interface ColumnMap {
  fields: Partial<Record<Field, number>>;
  /** Shopify-style option pairs: name column (optional) and value column. */
  options: Array<{ nameCol?: number; valueCol: number; fallbackName: string }>;
  attributes: Array<{ col: number; name: string }>;
  ignored: number[];
}

function mapDeterministic(headers: string[]): { map: ColumnMap; unknown: number[] } {
  const map: ColumnMap = { fields: {}, options: [], attributes: [], ignored: [] };
  const unknown: number[] = [];
  const optionNames = new Map<string, number>();
  headers.forEach((h, col) => {
    const n = normHeader(h);
    const optName = OPTION_NAME.exec(n);
    if (optName) {
      optionNames.set(optName[1]!, col);
      return;
    }
    const optValue = OPTION_VALUE.exec(n);
    if (optValue) {
      map.options.push({ valueCol: col, fallbackName: `option${optValue[1]}` });
      return;
    }
    const field = ALIASES[n];
    if (field && map.fields[field] === undefined) map.fields[field] = col;
    else unknown.push(col);
  });
  for (const o of map.options) {
    const nameCol = optionNames.get(o.fallbackName.slice(-1));
    if (nameCol !== undefined) o.nameCol = nameCol;
  }
  return { map, unknown };
}

const SYSTEM = `You map the columns of a shop's product spreadsheet to catalog fields. Reply with one JSON object only:
{"columns":[{"header":"<header exactly as written>","field":"sku|parent|name|category|description|price|stock|cost|floor|weight_g|lead_time_days|flags|purchasable|attribute|ignore","attribute":"<short snake_case name, only when field is attribute>"}],"values":[{"attribute":"<snake_case attribute name>","from":"<value as written>","to":"<the same value, spelled consistently>"}]}
columns: one entry per header. "attribute" is something a buyer chooses or filters on (colour, size, roast). "ignore" is for notes and internal columns.
values: only to make the same option read the same way (case, spacing, punctuation). Never change what a value means, never translate, never guess.`;

interface LlmMapping {
  columns: Array<{ header: string; field: string; attribute?: string }>;
  values: Array<{ attribute: string; from: string; to: string }>;
}

function canon(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Drafts from a CSV paste. Common headers (Shopify exports, plain
 * sku/name/price/stock/cost sheets) are read directly; the model is asked
 * only when some headers are not plain, to map them and to make attribute
 * spellings consistent, and its answer is checked: it can map only real
 * headers and can change a value's spelling but not its meaning.
 */
export async function fromCsv(text: string, deps: ImportDeps): Promise<ProductDraft[]> {
  const { models, policy } = resolved(deps);
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (err) {
    throw new ImportError(err instanceof Error ? err.message : String(err), "invalid_input");
  }
  const { headers, rows } = parsed;
  if (!rows.length) throw new ImportError("The CSV has a header but no product rows.", "invalid_input");

  const { map, unknown } = mapDeterministic(headers);
  const batchWarnings: string[] = [];
  const valueFixes: LlmMapping["values"] = [];

  const needsModel =
    unknown.some((c) => !isPlainHeader(headers[c]!)) ||
    map.options.some((o) => o.nameCol === undefined) ||
    map.fields.name === undefined ||
    map.fields.price === undefined;

  let unresolved = unknown;
  if (needsModel && (unknown.length || map.options.length)) {
    try {
      const reply = await askJson(deps.llm, {
        model: models.text,
        system: SYSTEM,
        user: JSON.stringify({ headers, sample_rows: rows.slice(0, 5) }, null, 1),
        maxTokens: 1200,
      });
      const mapping = readMapping(reply);
      unresolved = applyMapping(mapping, headers, map, unknown);
      valueFixes.push(...mapping.values);
    } catch {
      batchWarnings.push(`Some columns could not be matched (${unknown.map((c) => headers[c]).join(", ")}); they were kept as attributes. Check them.`);
    }
  }
  for (const col of unresolved) {
    const name = attributeKey(headers[col]!);
    if (name && !map.attributes.some((a) => a.name === name)) map.attributes.push({ col, name });
  }
  if (map.fields.name === undefined && map.fields.parent === undefined) {
    throw new ImportError("The CSV needs a product name column (name, title or product).", "invalid_input");
  }

  // Group rows into products: by parent/handle, else by name.
  const groups = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const key = cell(row, map.fields.parent) || cell(row, map.fields.name);
    if (!key) return;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });

  const drafts: ProductDraft[] = [];
  for (const [key, indexes] of groups) {
    const groupRows = indexes.map((i) => rows[i]!);
    const first = (col: number | undefined) => groupRows.map((r) => cell(r, col)).find(Boolean) ?? "";
    const name = first(map.fields.name) || key;
    const warnings = [...batchWarnings];
    const description = first(map.fields.description);
    if (!description) warnings.push("No description: add one so agents can answer buyers' questions.");

    const order: string[] = [];
    let stockUnknown = false;
    const variants: VariantDraft[] = groupRows.map((row, j) => {
      const rowNo = indexes[j]! + 2;
      const attributes: Record<string, string> = {};
      const put = (k: string, v: string) => {
        if (!k || !v) return;
        attributes[k] = v;
        if (!order.includes(k)) order.push(k);
      };
      for (const o of map.options) put(attributeKey(cell(row, o.nameCol) || o.fallbackName), tidy(cell(row, o.valueCol)));
      for (const a of map.attributes) put(a.name, tidy(cell(row, a.col)));

      const priceCents = parseMoneyCents(cell(row, map.fields.price)) ?? 0;
      if (!priceCents) warnings.push(`Row ${rowNo} has no price: set one before publishing.`);
      const stockRaw = cell(row, map.fields.stock);
      const stock = /^\d+$/.test(stockRaw) ? Number(stockRaw) : 0;
      if (!/^\d+$/.test(stockRaw)) stockUnknown = true;
      const costCents = parseMoneyCents(cell(row, map.fields.cost));
      const weightG = Number(cell(row, map.fields.weight_g)) || undefined;
      const lead = Number(cell(row, map.fields.lead_time_days));
      const purchasableRaw = cell(row, map.fields.purchasable).toLowerCase();
      const v: VariantDraft = {
        variantId: "",
        attributes,
        priceCents,
        stock,
        floorCents: 0,
        flags: cell(row, map.fields.flags)
          .split(/[;,|]/)
          .map((f) => attributeKey(f))
          .filter(Boolean),
        purchasable: !["false", "no", "0", "n"].includes(purchasableRaw),
        leadTimeDays: Number.isInteger(lead) && lead > 0 ? lead : 0,
        ...(costCents ? { costCents } : {}),
        ...(weightG && weightG > 0 ? { weightG: Math.round(weightG) } : {}),
      };
      const floor = parseMoneyCents(cell(row, map.fields.floor));
      v.floorCents = floor !== undefined && priceCents ? Math.min(floor, priceCents) : suggestFloor(v, undefined, policy);
      return v;
    });
    if (stockUnknown) warnings.push("Stock is missing for some rows: set stock before publishing.");

    normaliseValues(variants, valueFixes);
    const draft: ProductDraft = {
      parentId: slug(cell(groupRows[0]!, map.fields.parent) || name, 32) || "ITEM",
      name,
      category: (first(map.fields.category) || "general").toLowerCase(),
      description,
      attributesOrder: order,
      variants,
      source: { kind: "csv", ref: rowRef(indexes.map((i) => i + 2)) },
      warnings,
    };
    assignVariantIds(draft, "").forEach((id, i) => (draft.variants[i]!.variantId = id));
    drafts.push(draft);
  }
  if (!drafts.length) throw new ImportError("No row in the CSV names a product.", "invalid_input");
  return drafts;
}

function cell(row: string[], col: number | undefined): string {
  return col === undefined ? "" : (row[col] ?? "").trim();
}

function tidy(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

function readMapping(reply: Record<string, unknown>): LlmMapping {
  const columns = Array.isArray(reply.columns) ? reply.columns : [];
  const values = Array.isArray(reply.values) ? reply.values : [];
  const str = (o: unknown, k: string) => (o && typeof o === "object" && typeof (o as Record<string, unknown>)[k] === "string" ? String((o as Record<string, unknown>)[k]) : "");
  return {
    columns: columns.map((c) => ({ header: str(c, "header"), field: str(c, "field"), attribute: str(c, "attribute") })),
    values: values.map((v) => ({ attribute: attributeKey(str(v, "attribute")), from: str(v, "from"), to: str(v, "to") })),
  };
}

/** Applies the model's column choices to columns it may decide; returns those still unmatched. */
function applyMapping(mapping: LlmMapping, headers: string[], map: ColumnMap, unknown: number[]): number[] {
  const left = new Set(unknown);
  for (const c of mapping.columns) {
    const col = headers.indexOf(c.header);
    if (col < 0) continue;
    if (c.field === "attribute" && attributeKey(c.attribute ?? "")) {
      const name = attributeKey(c.attribute!);
      if (left.has(col) && !map.attributes.some((a) => a.name === name)) {
        map.attributes.push({ col, name });
        left.delete(col);
      } else {
        // An option value column the model named.
        const opt = map.options.find((o) => o.valueCol === col && o.nameCol === undefined);
        if (opt) opt.fallbackName = name;
      }
    } else if (c.field === "ignore" && left.has(col)) {
      map.ignored.push(col);
      left.delete(col);
    } else if ((FIELDS as readonly string[]).includes(c.field) && left.has(col) && map.fields[c.field as Field] === undefined) {
      map.fields[c.field as Field] = col;
      left.delete(col);
    }
  }
  return [...left];
}

/**
 * Same option, same spelling: values equal apart from case and punctuation
 * take the first spelling seen, then the model's spelling where it gave one
 * that differs only in case and punctuation.
 */
function normaliseValues(variants: VariantDraft[], fixes: LlmMapping["values"]): void {
  const keys = new Set(variants.flatMap((v) => Object.keys(v.attributes)));
  for (const key of keys) {
    const spelling = new Map<string, string>();
    for (const v of variants) {
      const value = v.attributes[key];
      if (value !== undefined && !spelling.has(canon(value))) spelling.set(canon(value), value);
    }
    for (const f of fixes) {
      if (f.attribute === key && f.to && canon(f.from) === canon(f.to) && spelling.has(canon(f.to))) spelling.set(canon(f.to), tidy(f.to));
    }
    for (const v of variants) {
      const value = v.attributes[key];
      if (value !== undefined) v.attributes[key] = spelling.get(canon(value)) ?? value;
    }
  }
}

/** "rows 2-4", "rows 5" or "rows 2, 5, 9". */
function rowRef(nums: number[]): string {
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1);
  if (nums.length === 1) return `rows ${nums[0]}`;
  return contiguous ? `rows ${nums[0]}-${nums.at(-1)}` : `rows ${nums.join(", ")}`;
}
