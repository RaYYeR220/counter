import { describe, expect, it } from "vitest";
import type { C3Product } from "../src/channel3/port";
import { importDrafts } from "../src/pipeline";
import { fakeChannel3, offer, scriptedLlm } from "./fakes";

const PAGE = "https://juniperclay.example/products/speckled-mug";
const now = () => new Date("2026-11-09T12:00:00.000Z");

const PRODUCT: C3Product = {
  id: "p1",
  title: "Speckled mug",
  description: "A wheel-thrown speckled stoneware mug.",
  category: { slug: "mugs", title: "Mugs" },
  offers: [offer("juniperclay.example", 34)],
  variants: { options: [{ name: "Glaze", values: [{ label: "sage" }, { label: "ink" }] }] },
};

const MARKET: C3Product[] = [
  { id: "a", title: "Speckled stoneware mug", offers: [offer("one.example", 33)] },
  { id: "b", title: "Speckled mug", offers: [offer("two.example", 36)] },
  { id: "own", title: "Speckled mug", offers: [offer("juniperclay.example", 34)] },
];

const REPLY = JSON.stringify({ attributes: [{ source: "Glaze", name: "glaze" }], description: "A wheel-thrown speckled stoneware mug." });

describe("importDrafts", () => {
  it("adds a market check to a URL import and raises floors to 90% of the market low", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: PRODUCT }, search: [{ match: /mug/i, products: MARKET }] });
    const [d] = await importDrafts({ url: PAGE }, { channel3: f.c3, llm: scriptedLlm([REPLY]).llm, now, policy: { maxDiscountPct: 15 } });
    expect(d!.market).toMatchObject({ lowCents: 3300, medianCents: 3450, highCents: 3600, position: "within", priceCents: 3400 });
    // max(3400 × 0.85 → 2850, 3300 × 0.9 = 2970)
    expect(d!.variants.map((v) => v.floorCents)).toEqual([2970, 2970]);
  });

  it("keeps a floor the CSV set by hand", async () => {
    const f = fakeChannel3({ search: [{ match: /mug/i, products: MARKET }] });
    const csv = "name,glaze,price,stock,floor\nSpeckled mug,sage,34,3,25\nSpeckled mug,ink,34,3,\n";
    const [d] = await importDrafts({ csv }, { channel3: f.c3, llm: scriptedLlm([]).llm, now, policy: { maxDiscountPct: 15 } });
    expect(d!.variants.map((v) => v.floorCents)).toEqual([2500, 2970]);
  });

  it("returns the draft with a warning when the market check fails", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: PRODUCT } });
    f.c3.search = async () => {
      throw new Error("Channel3 is down");
    };
    const [d] = await importDrafts({ url: PAGE }, { channel3: f.c3, llm: scriptedLlm([REPLY]).llm, now });
    expect(d!.market).toBeUndefined();
    expect(d!.warnings).toContainEqual(expect.stringMatching(/market check.*Channel3 is down/));
  });

  it("can skip the market check", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: PRODUCT } });
    await importDrafts({ url: PAGE }, { channel3: f.c3, llm: scriptedLlm([REPLY]).llm, now }, { market: false });
    expect(f.searches).toEqual([]);
  });

  it("does not check the market twice for a photo", async () => {
    const f = fakeChannel3({ search: [{ match: /mug/i, products: MARKET }] });
    const seen = JSON.stringify({ name: "Speckled mug", category: "mugs", attributes: [], uncertain: [] });
    await importDrafts(
      { photo: { bytes: new Uint8Array([1, 2, 3]), mime: "image/png" } },
      { channel3: f.c3, llm: scriptedLlm([seen]).llm, now },
    );
    expect(f.searches).toHaveLength(1);
  });
});
