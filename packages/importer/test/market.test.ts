import { describe, expect, it } from "vitest";
import { marketCheck, positionOf, priceStats } from "../src/market";
import type { ProductDraft, VariantDraft } from "../src/types";
import { fakeChannel3, offer } from "./fakes";

const v = (attributes: Record<string, string>, priceCents: number): VariantDraft => ({
  variantId: "",
  attributes,
  priceCents,
  stock: 3,
  floorCents: 0,
  flags: [],
  purchasable: true,
  leadTimeDays: 0,
});

const MUG: ProductDraft = {
  parentId: "SPECKLED-MUG",
  name: "Speckled mug",
  category: "mugs",
  description: "",
  attributesOrder: ["glaze", "size"],
  variants: [v({ glaze: "sage", size: "8 oz" }, 3000), v({ glaze: "sage", size: "12 oz" }, 3400), v({ glaze: "ink", size: "16 oz" }, 3800)],
  source: { kind: "url", ref: "https://juniperclay.example/products/speckled-mug" },
  warnings: [],
};

const now = () => new Date("2026-11-09T12:00:00.000Z");
const p = (id: string, title: string, offers: ReturnType<typeof offer>[]) => ({ id, title, offers });

describe("priceStats", () => {
  it("uses min and max under four prices", () => {
    expect(priceStats([1200, 900, 3000])).toEqual({ lowCents: 900, medianCents: 1200, highCents: 3000 });
  });

  it("uses quartiles from four prices up, so one outlier does not set the range", () => {
    expect(priceStats([249, 1295, 1595, 2800, 3500, 5400])).toEqual({ lowCents: 1295, medianCents: 2198, highCents: 3500 });
  });
});

describe("positionOf", () => {
  it("places a price against the range", () => {
    const r = { lowCents: 1000, highCents: 2000 };
    expect(positionOf(999, r)).toBe("below");
    expect(positionOf(1000, r)).toBe("within");
    expect(positionOf(2000, r)).toBe("within");
    expect(positionOf(2001, r)).toBe("above");
  });
});

describe("marketCheck", () => {
  it("searches by name and sizing attributes of the median-priced variant", async () => {
    const f = fakeChannel3({ search: [{ match: /mug/, products: [] }] });
    await marketCheck(MUG, { channel3: f.c3, now });
    expect(f.searches[0]!.query).toBe("Speckled mug 12 oz");
  });

  it("adds only the first attribute every variant shares, so filters do not crowd the query", async () => {
    const f = fakeChannel3({ search: [{ match: /mug/i, products: [] }] });
    const shared = { material: "Ceramic", microwave_safe: "Microwave safe", shape: "Round" };
    const d = {
      ...MUG,
      name: "Morning mug",
      attributesOrder: ["color", "material", "microwave_safe", "shape"],
      variants: [v({ color: "Sand", ...shared }, 5400), v({ color: "Moss", ...shared }, 5400)],
    };
    await marketCheck(d, { channel3: f.c3, now });
    expect(f.searches[0]!.query).toBe("Morning mug Ceramic");
  });

  it("takes a search query from the caller", async () => {
    const f = fakeChannel3({ search: [{ match: /mug/, products: [] }] });
    await marketCheck(MUG, { channel3: f.c3, now }, { query: "speckled stoneware mug green" });
    expect(f.searches[0]!.query).toBe("speckled stoneware mug green");
  });

  it("summarises comparable offers and where our price sits", async () => {
    const f = fakeChannel3({
      search: [
        {
          match: /mug/,
          products: [
            p("a", "Speckled Stoneware Mug", [offer("home-goods.example", 12.95)]),
            p("b", "Handmade speckled mug 12 oz", [offer("makers-market.example", 38), offer("potter.example", 42)]),
            p("c", "Morning mug", [offer("hearth-and-kiln.example", 54)]),
          ],
        },
      ],
    });
    const m = await marketCheck(MUG, { channel3: f.c3, now });
    expect(m).toEqual({
      comparable: [
        { title: "Speckled Stoneware Mug", merchant: "home-goods.example", priceCents: 1295, url: "https://buy.trychannel3.com/x-home-goods.example" },
        { title: "Handmade speckled mug 12 oz", merchant: "makers-market.example", priceCents: 3800, url: "https://buy.trychannel3.com/x-makers-market.example" },
        { title: "Morning mug", merchant: "hearth-and-kiln.example", priceCents: 5400, url: "https://buy.trychannel3.com/x-hearth-and-kiln.example" },
      ],
      lowCents: 1295,
      medianCents: 3800,
      highCents: 5400,
      position: "within",
      priceCents: 3400,
      checkedAt: "2026-11-09T12:00:00.000Z",
    });
  });

  it("leaves out obvious mismatches: other product types, other sizes, sets, other currencies", async () => {
    const f = fakeChannel3({
      search: [
        {
          match: /mug/,
          products: [
            p("ok", "Stoneware mug", [offer("high-street.example", 7.99)]),
            p("plate", "Speckled dinner plate", [offer("plates.example", 20)]),
            p("size", "Speckled mug, 20 oz", [offer("big.example", 25)]),
            p("set", "Speckled mugs, set of 4", [offer("sets.example", 60)]),
            p("eur", "Speckled mug", [{ ...offer("eu.example", 30), price: { price: 30, currency: "EUR", compare_at_price: null } }]),
          ],
        },
      ],
    });
    const m = await marketCheck(MUG, { channel3: f.c3, now });
    expect(m?.comparable.map((c) => c.merchant)).toEqual(["high-street.example"]);
    expect(m?.position).toBe("above");
  });

  it("does not count the shop's own listing as market", async () => {
    const f = fakeChannel3({
      search: [
        {
          match: /mug/,
          products: [
            p("own", "Speckled mug", [offer("juniperclay.example", 34)]),
            p("other", "Speckled mug", [offer("other.example", 30)]),
          ],
        },
      ],
    });
    const m = await marketCheck(MUG, { channel3: f.c3, now });
    expect(m?.comparable.map((c) => c.merchant)).toEqual(["other.example"]);
  });

  it("leaves out the merchant the draft was imported from", async () => {
    const f = fakeChannel3({
      search: [
        {
          match: /mug/,
          products: [p("self", "Speckled mug", [offer("discount-home.example", 2.49)]), p("other", "Speckled mug", [offer("other.example", 30)])],
        },
      ],
    });
    const fromBuyLink = { ...MUG, source: { kind: "url" as const, ref: "https://buy.trychannel3.com/DeF5678-QrS1-S666bu", merchant: "discount-home.example" } };
    const m = await marketCheck(fromBuyLink, { channel3: f.c3, now });
    expect(m?.comparable.map((c) => c.merchant)).toEqual(["other.example"]);
  });

  it("counts any title that says set, bundle or pack as a set", async () => {
    const f = fakeChannel3({
      search: [{ match: /mug/, products: [p("s", "Mug Set", [offer("a.example", 60)]), p("b", "Speckled mug bundle", [offer("b.example", 50)]), p("ok", "Speckled mug", [offer("c.example", 30)])] }],
    });
    const m = await marketCheck(MUG, { channel3: f.c3, now });
    expect(m?.comparable.map((c) => c.merchant)).toEqual(["c.example"]);
  });

  it("uses each product's cheapest in-stock offer", async () => {
    const f = fakeChannel3({
      search: [
        {
          match: /mug/,
          products: [
            p("a", "Speckled mug", [offer("one.example", 40), { ...offer("two.example", 20), availability: "OutOfStock" }, offer("three.example", 30)]),
          ],
        },
      ],
    });
    const m = await marketCheck(MUG, { channel3: f.c3, now });
    expect(m?.comparable).toEqual([expect.objectContaining({ merchant: "three.example", priceCents: 3000 })]);
  });

  it("adds the photo to the search when Channel3 takes images", async () => {
    const withImages = fakeChannel3({ imageSearch: true, search: [{ match: /mug/, products: [] }] });
    await marketCheck(MUG, { channel3: withImages.c3, now }, { imageBase64: "AAAA" });
    expect(withImages.searches[0]).toMatchObject({ query: "Speckled mug 12 oz", imageBase64: "AAAA" });

    const textOnly = fakeChannel3({ search: [{ match: /mug/, products: [] }] });
    await marketCheck(MUG, { channel3: textOnly.c3, now }, { imageBase64: "AAAA" });
    expect(textOnly.searches[0]!.imageBase64).toBeUndefined();
  });

  it("is undefined when nothing comparable comes back", async () => {
    const f = fakeChannel3({ search: [{ match: /mug/, products: [p("x", "Garden hose", [offer("hose.example", 20)])] }] });
    expect(await marketCheck(MUG, { channel3: f.c3, now })).toBeUndefined();
  });
});
