import { describe, expect, it } from "vitest";
import { assignVariantIds, toVariantRows } from "../src/rows";
import type { ProductDraft, VariantDraft } from "../src/types";

const v = (attributes: Record<string, string>, extra: Partial<VariantDraft> = {}): VariantDraft => ({
  variantId: "",
  attributes,
  priceCents: 3400,
  stock: 5,
  floorCents: 2850,
  flags: [],
  purchasable: true,
  leadTimeDays: 0,
  ...extra,
});

const draft = (variants: VariantDraft[], extra: Partial<ProductDraft> = {}): ProductDraft => ({
  parentId: "MORNING-MUG",
  name: "Morning mug",
  category: "mugs",
  description: "A wheel-thrown mug.",
  attributesOrder: ["glaze", "size", "material"],
  variants,
  source: { kind: "csv" },
  warnings: [],
  ...extra,
});

const SHOP = { slug: "juniper-clay", orderPrefix: "JC" };

describe("assignVariantIds", () => {
  it("builds uppercase ids from the prefix, parent and the values that vary", () => {
    const d = draft([
      v({ glaze: "sage", size: "12 oz", material: "stoneware" }),
      v({ glaze: "Ink blue", size: "16 oz", material: "stoneware" }),
    ]);
    expect(assignVariantIds(d, "JC")).toEqual(["JC-MORNING-MUG-SAGE-12-OZ", "JC-MORNING-MUG-INK-BLUE-16-OZ"]);
  });

  it("uses attributesOrder for the order of values", () => {
    const d = draft([v({ size: "8 oz", glaze: "oat" }), v({ size: "12 oz", glaze: "oat" })], {
      attributesOrder: ["size", "glaze"],
    });
    expect(assignVariantIds(d, "JC")).toEqual(["JC-MORNING-MUG-8-OZ", "JC-MORNING-MUG-12-OZ"]);
  });

  it("gives a single variant the parent id", () => {
    expect(assignVariantIds(draft([v({ material: "stoneware" })]), "JC")).toEqual(["JC-MORNING-MUG"]);
  });

  it("does not repeat a prefix the parent already carries", () => {
    const d = draft([v({ glaze: "sage" }), v({ glaze: "ink" })], { parentId: "jc-mug-speckle" });
    expect(assignVariantIds(d, "JC")).toEqual(["JC-MUG-SPECKLE-SAGE", "JC-MUG-SPECKLE-INK"]);
  });

  it("is stable: the same draft always gets the same ids", () => {
    const d = draft([v({ glaze: "sage" }), v({ glaze: "ink" })]);
    expect(assignVariantIds(d, "JC")).toEqual(assignVariantIds(structuredClone(d), "JC"));
  });

  it("keeps each variant's id when the variants are reordered", () => {
    const a = v({ glaze: "sage" });
    const b = v({ glaze: "ink" });
    expect(assignVariantIds(draft([b, a]), "JC")).toEqual(assignVariantIds(draft([a, b]), "JC").reverse());
  });

  it("numbers values that collide after slugging", () => {
    const d = draft([v({ size: "12 oz" }), v({ size: "12-oz" }), v({ size: "12 OZ" })]);
    expect(assignVariantIds(d, "JC")).toEqual(["JC-MORNING-MUG-12-OZ", "JC-MORNING-MUG-12-OZ-2", "JC-MORNING-MUG-12-OZ-3"]);
  });

  it("avoids ids already taken by other drafts in the same batch", () => {
    const taken = new Set(["JC-MORNING-MUG-SAGE"]);
    const ids = assignVariantIds(draft([v({ glaze: "sage" }), v({ glaze: "ink" })]), "JC", taken);
    expect(ids).toEqual(["JC-MORNING-MUG-SAGE-2", "JC-MORNING-MUG-INK"]);
    expect(taken.has("JC-MORNING-MUG-SAGE-2")).toBe(true);
  });

  it("leaves the prefix out when it is empty, for provisional draft ids", () => {
    expect(assignVariantIds(draft([v({ glaze: "sage" }), v({ glaze: "ink" })]), "")).toEqual(["MORNING-MUG-SAGE", "MORNING-MUG-INK"]);
  });

  it("falls back to ITEM for a parent with no letters or digits", () => {
    expect(assignVariantIds(draft([v({})], { parentId: "—" }), "JC")).toEqual(["JC-ITEM"]);
  });
});

describe("toVariantRows", () => {
  it("maps a draft to variants rows with storefront URLs and positions", () => {
    const d = draft([
      v({ glaze: "sage", size: "12 oz" }, { costCents: 1150, weightG: 380, flags: ["seconds"] }),
      v({ glaze: "ink", size: "12 oz" }, { stock: 0, leadTimeDays: 14 }),
    ]);
    const rows = toVariantRows(d, SHOP, { publicBaseUrl: "https://counter.example", startPosition: 40 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "juniper-clay:JC-MORNING-MUG-SAGE",
      shopId: "juniper-clay",
      variantId: "JC-MORNING-MUG-SAGE",
      parentId: "JC-MORNING-MUG",
      productName: "Morning mug",
      name: "Morning mug — sage",
      category: "mugs",
      description: "A wheel-thrown mug.",
      url: "https://counter.example/s/juniper-clay/p/JC-MORNING-MUG?v=JC-MORNING-MUG-SAGE",
      priceCents: 3400,
      costCents: 1150,
      floorCents: 2850,
      stock: 5,
      attributes: { glaze: "sage", size: "12 oz" },
      flags: ["seconds"],
      purchasable: true,
      leadTimeDays: 0,
      weightG: 380,
      active: true,
      position: 40,
    });
    expect(rows[1]).toMatchObject({ variantId: "JC-MORNING-MUG-INK", costCents: 0, weightG: 0, position: 41, leadTimeDays: 14 });
  });

  it("stores the market check on each variant, placed against that variant's price", () => {
    const market = {
      comparable: [{ title: "Mug", merchant: "a.example", priceCents: 3000, url: "https://a.example/m" }],
      lowCents: 3000,
      medianCents: 3200,
      highCents: 3500,
      position: "within" as const,
      priceCents: 3400,
      checkedAt: "2026-11-09T12:00:00.000Z",
    };
    const d = draft([v({ size: "8 oz" }, { priceCents: 2900 }), v({ size: "16 oz" }, { priceCents: 3800 })], { market });
    const rows = toVariantRows(d, SHOP, { publicBaseUrl: "https://counter.example" });
    expect(rows.map((r) => r.market)).toEqual([
      { ...market, priceCents: 2900, position: "below" },
      { ...market, priceCents: 3800, position: "above" },
    ]);
  });

  it("names a variant with every attribute when none of them vary", () => {
    const [row] = toVariantRows(draft([v({ size: "16 oz" })], { attributesOrder: ["size"] }), SHOP, {
      publicBaseUrl: "https://counter.example",
    });
    expect(row!.name).toBe("Morning mug — 16 oz");
  });
});
