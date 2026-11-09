import { describe, expect, it } from "vitest";
import { fromCsv } from "../src/from-csv";
import { fakeChannel3, noLlm, scriptedLlm } from "./fakes";

const c3 = fakeChannel3({}).c3;
const policy = { maxDiscountPct: 15 };

describe("fromCsv", () => {
  it("groups rows into products with Shopify-style options, without the model", async () => {
    const csv = [
      "Handle,Title,Type,Body,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Price,Variant Inventory Qty,Cost per item,Variant Grams",
      'speckled-mug,"Speckled mug, wheel-thrown",mugs,"Holds 8 or 12 oz, dishwasher safe",Glaze,sage,Size,8 oz,M-S-8,30.00,4,9.50,300',
      "speckled-mug,,,,Glaze,sage,Size,12 oz,M-S-12,34.00,6,11.50,380",
      "speckled-mug,,,,Glaze,ink,Size,12 oz,M-I-12,34.00,0,11.50,380",
      "pour-over,Pour-over cone,coffee,One-cup cone.,,,,,P-1,48,3,,1300",
    ].join("\n");
    const drafts = await fromCsv(csv, { channel3: c3, llm: noLlm, policy });

    expect(drafts).toHaveLength(2);
    const [mug, cone] = drafts;
    expect(mug).toMatchObject({
      parentId: "SPECKLED-MUG",
      name: "Speckled mug, wheel-thrown",
      category: "mugs",
      description: "Holds 8 or 12 oz, dishwasher safe",
      attributesOrder: ["glaze", "size"],
      source: { kind: "csv", ref: "rows 2-4" },
    });
    expect(mug!.variants.map((v) => [v.variantId, v.attributes, v.priceCents, v.stock, v.costCents, v.weightG])).toEqual([
      ["SPECKLED-MUG-SAGE-8-OZ", { glaze: "sage", size: "8 oz" }, 3000, 4, 950, 300],
      ["SPECKLED-MUG-SAGE-12-OZ", { glaze: "sage", size: "12 oz" }, 3400, 6, 1150, 380],
      ["SPECKLED-MUG-INK-12-OZ", { glaze: "ink", size: "12 oz" }, 3400, 0, 1150, 380],
    ]);
    // max(cost × 1.25 = 1438, 3400 × 0.85 → 2850)
    expect(mug!.variants[1]!.floorCents).toBe(2850);
    expect(cone).toMatchObject({ parentId: "POUR-OVER", attributesOrder: [], source: { ref: "rows 5" } });
    expect(cone!.variants).toEqual([
      expect.objectContaining({ variantId: "POUR-OVER", attributes: {}, priceCents: 4800, stock: 3, purchasable: true, leadTimeDays: 0, flags: [] }),
    ]);
  });

  it("reads plain attribute columns and the shop's own fields", async () => {
    const csv = [
      "sku,name,category,description,glaze,size,price,stock,cost,floor,lead_time_days,flags,purchasable",
      "BS-SAGE,Serving bowl,bowls,Made to order.,sage,,$120.00,0,40,105,21,made_to_order,yes",
      "BS-INK,Serving bowl,bowls,Made to order.,ink,,$120.00,0,40,,21,made_to_order;seconds,no",
    ].join("\n");
    const [bowl] = await fromCsv(csv, { channel3: c3, llm: noLlm, policy });
    expect(bowl!.attributesOrder).toEqual(["glaze"]);
    expect(bowl!.variants.map((v) => [v.attributes, v.floorCents, v.leadTimeDays, v.flags, v.purchasable])).toEqual([
      [{ glaze: "sage" }, 10500, 21, ["made_to_order"], true],
      [{ glaze: "ink" }, 10200, 21, ["made_to_order", "seconds"], false],
    ]);
  });

  it("warns about rows without a price and products without stock or a description", async () => {
    const csv = "name,size,price\nTote,small,\nTote,large,18\n";
    const [tote] = await fromCsv(csv, { channel3: c3, llm: noLlm, policy });
    expect(tote!.variants.map((v) => v.priceCents)).toEqual([0, 1800]);
    expect(tote!.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/row 2.*price/i),
        expect.stringMatching(/set stock before publishing/i),
        expect.stringMatching(/description/i),
      ]),
    );
  });

  it("asks the model to map headers it does not know, and checks the answer", async () => {
    const csv = [
      "Item,Retail $,Qty on hand (shop),Colour/Glaze,Notes for me",
      "Speckled mug,34,6,SAGE,reorder soon",
      "Speckled mug,34,2,Sage ,",
      "Speckled mug,34,1,ink,",
    ].join("\n");
    const s = scriptedLlm([
      JSON.stringify({
        columns: [
          { header: "Retail $", field: "price" },
          { header: "Qty on hand (shop)", field: "stock" },
          { header: "Colour/Glaze", field: "attribute", attribute: "Glaze" },
          { header: "Notes for me", field: "ignore" },
          { header: "Not a column", field: "cost" },
        ],
        values: [
          { attribute: "glaze", from: "SAGE", to: "sage" },
          { attribute: "glaze", from: "ink", to: "charcoal" },
        ],
      }),
    ]);
    const [mug] = await fromCsv(csv, { channel3: c3, llm: s.llm, policy, models: { text: "text-model" } });
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]!.model).toBe("text-model");
    expect(String(s.requests[0]!.messages[1]!.content)).toContain("Qty on hand (shop)");
    expect(mug!.attributesOrder).toEqual(["glaze"]);
    // "SAGE" and "Sage " become "sage"; "ink" stays "ink" because "charcoal" is a different value.
    expect(mug!.variants.map((v) => [v.attributes, v.priceCents, v.stock])).toEqual([
      [{ glaze: "sage" }, 3400, 6],
      [{ glaze: "sage" }, 3400, 2],
      [{ glaze: "ink" }, 3400, 1],
    ]);
  });

  it("falls back to the headers as written when the model fails", async () => {
    const csv = "Item,Retail $,Colour/Glaze\nMug,34,sage\nMug,34,ink\n";
    const [mug] = await fromCsv(csv, { channel3: c3, llm: scriptedLlm(["?", "?"]).llm, policy });
    expect(mug!.attributesOrder).toEqual(["retail", "colour_glaze"]);
    expect(mug!.warnings).toContainEqual(expect.stringMatching(/columns/i));
  });

  it("rejects a CSV without rows or a product name column", async () => {
    await expect(fromCsv("name,price\n", { channel3: c3, llm: noLlm })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(fromCsv("colour,price\nred,3\n", { channel3: c3, llm: scriptedLlm(["{}"]).llm })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});
