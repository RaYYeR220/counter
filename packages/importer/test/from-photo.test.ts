import { describe, expect, it } from "vitest";
import { fromPhoto } from "../src/from-photo";
import { fakeChannel3, noLlm, offer, scriptedLlm } from "./fakes";

const PHOTO = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mime: "image/jpeg", filename: "mug.jpg" };
const now = () => new Date("2026-11-09T12:00:00.000Z");

const SEEN = JSON.stringify({
  name: "Speckled stoneware mug",
  category: "Mugs",
  description: "A speckled stoneware mug with a pale green glaze and a pulled handle. It holds about 12 oz.",
  attributes: [
    { name: "glaze", value: "pale green", confidence: "medium" },
    { name: "Handle", value: "pulled", confidence: "high" },
    { name: "size", value: "about 12 oz", confidence: "low" },
  ],
  uncertain: ["capacity", "whether it is dishwasher safe"],
  search_query: "speckled stoneware mug green",
});

const MARKET = [
  { id: "a", title: "Speckled Stoneware Mug", offers: [offer("crateandbarrel.com", 12.95)] },
  { id: "b", title: "Handmade speckled mug", offers: [offer("etsy.com", 38)] },
  { id: "c", title: "Speckled mug, sage", offers: [offer("potter.example", 30)] },
];

describe("fromPhoto", () => {
  it("sends the photo to the vision model as a data URI", async () => {
    const s = scriptedLlm([SEEN]);
    await fromPhoto(PHOTO, { channel3: fakeChannel3({}).c3, llm: s.llm, now, models: { vision: "vision-model" } });
    expect(s.requests[0]!.model).toBe("vision-model");
    const parts = s.requests[0]!.messages[1]!.content as unknown as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts[1]!.image_url!.url).toBe("data:image/jpeg;base64,/9j/4A==");
  });

  it("drafts what is visible and turns every doubt into a warning", async () => {
    const d = await fromPhoto(PHOTO, { channel3: fakeChannel3({}).c3, llm: scriptedLlm([SEEN]).llm, now });
    expect(d).toMatchObject({
      parentId: "SPECKLED-STONEWARE-MUG",
      name: "Speckled stoneware mug",
      category: "mugs",
      attributesOrder: ["glaze", "handle", "size"],
      source: { kind: "photo", ref: "mug.jpg" },
    });
    expect(d.variants).toHaveLength(1);
    expect(d.variants[0]).toMatchObject({
      variantId: "SPECKLED-STONEWARE-MUG",
      attributes: { glaze: "pale green", handle: "pulled", size: "about 12 oz" },
      stock: 0,
    });
    // A capacity read off a photo is a guess, so the sentence stating it is left out.
    expect(d.description).toBe("A speckled stoneware mug with a pale green glaze and a pulled handle.");
    expect(d.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/glaze.*pale green.*check/i),
        expect.stringMatching(/size.*about 12 oz.*check/i),
        expect.stringMatching(/capacity/),
        expect.stringMatching(/dishwasher safe/),
        expect.stringMatching(/set stock before publishing/i),
      ]),
    );
    expect(d.warnings.join(" ")).not.toMatch(/handle.*check/i);
  });

  it("looks up comparables by text and suggests the market median as the price", async () => {
    const f = fakeChannel3({ search: [{ match: /mug/i, products: MARKET }] });
    const d = await fromPhoto(PHOTO, { channel3: f.c3, llm: scriptedLlm([SEEN]).llm, now, policy: { maxDiscountPct: 15 } });
    expect(f.searches).toHaveLength(1);
    expect(f.searches[0]!.imageBase64).toBeUndefined();
    expect(d.market).toMatchObject({ lowCents: 1295, medianCents: 3000, highCents: 3800, position: "within", priceCents: 3000 });
    expect(d.variants[0]!.priceCents).toBe(3000);
    // max(3000 × 0.85 → 2550, 1295 × 0.9 → 1166)
    expect(d.variants[0]!.floorCents).toBe(2550);
    expect(d.warnings).toContainEqual(expect.stringMatching(/\$30\.00.*market median/i));
  });

  it("searches by the photo itself when Channel3 takes images", async () => {
    const f = fakeChannel3({ imageSearch: true, search: [{ match: /mug/i, products: MARKET }] });
    await fromPhoto(PHOTO, { channel3: f.c3, llm: scriptedLlm([SEEN]).llm, now });
    expect(f.searches[0]!.imageBase64).toBe("/9j/4A==");
  });

  it("leaves the price for the merchant when nothing comparable is found", async () => {
    const d = await fromPhoto(PHOTO, { channel3: fakeChannel3({}).c3, llm: scriptedLlm([SEEN]).llm, now });
    expect(d.market).toBeUndefined();
    expect(d.variants[0]!.priceCents).toBe(0);
    expect(d.warnings).toContainEqual(expect.stringMatching(/set a price/i));
  });

  it("still drafts when the market check fails", async () => {
    const f = fakeChannel3({});
    f.c3.search = async () => {
      throw new Error("Channel3 is down");
    };
    const d = await fromPhoto(PHOTO, { channel3: f.c3, llm: scriptedLlm([SEEN]).llm, now });
    expect(d.warnings).toContainEqual(expect.stringMatching(/market check/i));
  });

  it("refuses files that are not images, and photos the model cannot read", async () => {
    const c3 = fakeChannel3({}).c3;
    await expect(fromPhoto({ ...PHOTO, mime: "application/pdf" }, { channel3: c3, llm: noLlm })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(fromPhoto(PHOTO, { channel3: c3, llm: scriptedLlm(['{"name":""}']).llm })).rejects.toMatchObject({ code: "unreadable" });
  });
});
