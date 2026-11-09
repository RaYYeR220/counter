import { describe, expect, it } from "vitest";
import { JsonShopDirectory, type CatalogFeed } from "../src/index";
import { NOW, loadSeed } from "./harness";

const feed = loadSeed<CatalogFeed>();
const dir = new JsonShopDirectory(feed, { now: () => NOW });

describe("listShops", () => {
  it("summarises every shop in feed order", async () => {
    const shops = await dir.listShops();
    expect(shops.map((s) => s.shop)).toEqual(["juniper-clay", "northpaw-roasters", "loop-and-lantern"]);
    expect(shops[0]).toMatchObject({
      shop: "juniper-clay",
      name: "Juniper Clay",
      tagline: "Wheel-thrown stoneware for the everyday table.",
      location: "Portland, OR",
      ships_to: ["US"],
      returns_days: 30,
      product_count: 6,
      categories: ["mugs", "bowls", "plates", "coffee"],
    });
  });

  it("never exposes merchant-only data (costs, price floors, negotiation limits)", async () => {
    const text = JSON.stringify([
      await dir.listShops(),
      await dir.search({ query: "mug", limit: 50 }),
      await dir.getProduct("juniper-clay", "JC-MUG-SPECKLE"),
    ]);
    for (const secret of ["cost", "floor", "negotiation", "max_discount_pct", "weight_g"]) {
      expect(text).not.toContain(`"${secret}"`);
    }
  });
});

describe("search", () => {
  it("puts the exact variant first: green speckled mug 12 oz -> sage 12 oz", async () => {
    const hits = await dir.search({ query: "green speckled mug 12 oz" });
    expect(hits[0]).toMatchObject({
      shop: "juniper-clay",
      parent_id: "JC-MUG-SPECKLE",
      variant_id: "JC-MUG-SPECKLE-SAGE-12",
      attributes: { glaze: "sage", size: "12 oz" },
      price: "34.00",
      currency: "USD",
      in_stock: true,
      purchasable: true,
      flags: [],
    });
  });

  it("ranks a flagged variant (seconds) below the first-quality one unless asked for", async () => {
    const ids = (await dir.search({ query: "green speckled mug 12 oz" })).map((h) => h.variant_id);
    expect(ids.indexOf("JC-MUG-SPECKLE-SECONDS-SAGE-12")).toBeGreaterThan(0);
    const asked = await dir.search({ query: "seconds sage mug 12 oz" });
    expect(asked[0]!.variant_id).toBe("JC-MUG-SPECKLE-SECONDS-SAGE-12");
    expect(asked[0]!.flags).toEqual(["seconds"]);
  });

  it("is deterministic", async () => {
    const q = { query: "dark roast coffee 250 g", limit: 20 };
    expect(await dir.search(q)).toEqual(await dir.search(q));
  });

  it("understands colour synonyms (blue -> ink) and unit spellings (16oz)", async () => {
    const hits = await dir.search({ query: "blue 16oz mug" });
    expect(hits[0]!.variant_id).toBe("JC-MUG-SPECKLE-INK-16");
  });

  it("understands decaf and decaffeinated", async () => {
    for (const query of ["decaf coffee", "decaffeinated beans"]) {
      const top = (await dir.search({ query, limit: 5 })).map((h) => h.parent_id);
      expect(top.length).toBe(5);
      for (const p of top) expect(p).toMatch(/DECAF/);
    }
  });

  it("flags out-of-stock variants instead of hiding them", async () => {
    const hits = await dir.search({ query: "ink 16 oz speckled mug" });
    expect(hits[0]).toMatchObject({ variant_id: "JC-MUG-SPECKLE-INK-16", in_stock: false, stock: 0 });
  });

  it("flags variants that cannot be bought on their own", async () => {
    const hits = await dir.search({ query: "roaster's choice subscription" });
    expect(hits[0]).toMatchObject({ parent_id: "NP-CHOICE", purchasable: false, flags: ["subscription_only"] });
  });

  it("restricts to one shop and honours the limit", async () => {
    const hits = await dir.search({ query: "sage", shop: "juniper-clay", limit: 3 });
    expect(hits).toHaveLength(3);
    for (const h of hits) expect(h.shop).toBe("juniper-clay");
    expect(await dir.search({ query: "mug", shop: "loop-and-lantern" })).toEqual([]);
  });

  it("returns nothing when no word matches", async () => {
    expect(await dir.search({ query: "titanium bicycle" })).toEqual([]);
  });

  it("browses a shop in catalog order when the query is empty", async () => {
    const hits = await dir.search({ query: "", shop: "northpaw-roasters", limit: 2 });
    expect(hits.map((h) => h.variant_id)).toEqual(["NP-GUJI-LIGHT-WB-250", "NP-GUJI-LIGHT-WB-1KG"]);
  });
});

describe("getProduct", () => {
  it("lists every variant with stock, flags and delivery estimates", async () => {
    const p = await dir.getProduct("juniper-clay", "JC-MUG-SPECKLE");
    expect(p).not.toBeNull();
    expect(p!).toMatchObject({
      shop: "juniper-clay",
      shop_name: "Juniper Clay",
      parent_id: "JC-MUG-SPECKLE",
      name: "Speckled mug",
      category: "mugs",
      attributes_order: ["glaze", "size"],
      returns_days: 30,
    });
    expect(p!.description).toMatch(/speckled stoneware/);
    expect(p!.variants).toHaveLength(12);
    const sage12 = p!.variants.find((v) => v.variant_id === "JC-MUG-SPECKLE-SAGE-12")!;
    expect(sage12).toMatchObject({
      attributes: { glaze: "sage", size: "12 oz" },
      price: "34.00",
      stock: 6,
      in_stock: true,
      purchasable: true,
      flags: [],
      lead_time_days: 0,
      delivery: [
        // Mon Nov 9 + 2 handling days -> ships Wed Nov 11
        { id: "STANDARD", price: "5.99", estimated_delivery: "2026-11-18" },
        { id: "EXPRESS", price: "14.99", estimated_delivery: "2026-11-13" },
      ],
    });
    const ink16 = p!.variants.find((v) => v.variant_id === "JC-MUG-SPECKLE-INK-16")!;
    expect(ink16).toMatchObject({ stock: 0, in_stock: false });
  });

  it("pushes delivery out by the lead time for made-to-order pieces", async () => {
    const p = await dir.getProduct("juniper-clay", "JC-BOWL-SERVING");
    const v = p!.variants[0]!;
    expect(v).toMatchObject({ lead_time_days: 21, flags: ["made_to_order"] });
    // Ordered Mon Nov 9; thrown for 21 days (Mon Nov 30), 2 handling days (ships Wed Dec 2),
    // then 5 / 2 business days in transit. Free standard over $75.
    expect(v.delivery).toEqual([
      { id: "STANDARD", name: "Standard", price: "0.00", estimated_delivery: "2026-12-09" },
      { id: "EXPRESS", name: "Express", price: "14.99", estimated_delivery: "2026-12-04" },
    ]);
  });

  it("returns null for an unknown shop or product", async () => {
    expect(await dir.getProduct("juniper-clay", "NOPE")).toBeNull();
    expect(await dir.getProduct("nope", "JC-MUG-SPECKLE")).toBeNull();
  });
});
