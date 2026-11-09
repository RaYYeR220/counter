import { describe, expect, it } from "vitest";
import { Channel3Error, type C3Product } from "../src/channel3/port";
import { ImportError } from "../src/deps";
import { fromUrl } from "../src/from-url";
import { fakeChannel3, offer, scriptedLlm } from "./fakes";

const PAGE = "https://hearth-and-kiln.example/products/morning-mug";

/** What a URL lookup returns for a small shop: options and a price, few facts. */
const LOOKED_UP: C3Product = {
  id: "lkp0001",
  title: "Morning mug",
  description: "Wheel-thrown from speckled brown stoneware. Holds 16 ounces. Microwave and dishwasher safe.",
  brands: [{ name: "Hearth and Kiln" }],
  category: { slug: "mugs", title: "Mugs" },
  materials: ["speckled brown stoneware clay", "lead free glaze"],
  key_features: ["16 ounce capacity", "Hand-cut handle"],
  offers: [offer("other.example", 50), offer("hearth-and-kiln.example", 54)],
  variants: {
    options: [
      {
        name: "Color",
        values: [
          { label: "Sand", exists: true },
          { label: "Moss", exists: true },
          { label: "Gone", exists: false },
        ],
      },
      { name: "Size", values: [{ label: "12 oz" }, { label: "16 oz" }] },
    ],
  },
  structured_attributes: { "drinkware-material": ["Ceramic"], "cleaning-instructions": ["Dishwasher safe"] },
};

const GOOD_REPLY = JSON.stringify({
  attributes: [
    { source: "Size", name: "size" },
    { source: "Color", name: "glaze" },
    { source: "drinkware-material", name: "material" },
  ],
  description: "A wheel-thrown mug in speckled brown stoneware that holds 16 ounces. Microwave and dishwasher safe.",
});

const now = () => new Date("2026-11-09T12:00:00.000Z");

describe("fromUrl", () => {
  it("maps Channel3 options to one variant per combination", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: LOOKED_UP } });
    const { llm } = scriptedLlm([GOOD_REPLY]);
    const d = await fromUrl(`${PAGE}?utm_source=ig#top`, { channel3: f.c3, llm, now, policy: { maxDiscountPct: 15 } });

    expect(f.lookups).toEqual([PAGE]);
    expect(d.source).toMatchObject({ kind: "url", ref: PAGE });
    expect(d.name).toBe("Morning mug");
    expect(d.parentId).toBe("MORNING-MUG");
    expect(d.category).toBe("mugs");
    expect(d.attributesOrder).toEqual(["size", "glaze", "material"]);
    expect(d.variants.map((v) => v.attributes)).toEqual([
      { size: "12 oz", glaze: "Sand", material: "Ceramic" },
      { size: "12 oz", glaze: "Moss", material: "Ceramic" },
      { size: "16 oz", glaze: "Sand", material: "Ceramic" },
      { size: "16 oz", glaze: "Moss", material: "Ceramic" },
    ]);
    expect(d.variants.map((v) => v.variantId)).toEqual(["MORNING-MUG-12-OZ-SAND", "MORNING-MUG-12-OZ-MOSS", "MORNING-MUG-16-OZ-SAND", "MORNING-MUG-16-OZ-MOSS"]);
    // The page's own price, not another merchant's.
    expect(d.variants.every((v) => v.priceCents === 5400)).toBe(true);
    expect(d.variants[0]).toMatchObject({ stock: 0, floorCents: 4550, purchasable: true, leadTimeDays: 0, flags: [] });
  });

  it("warns that stock is unknown and prices are shared", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: LOOKED_UP } });
    const d = await fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm([GOOD_REPLY]).llm, now });
    expect(d.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/set stock before publishing/i), expect.stringMatching(/\$54\.00/)]),
    );
  });

  it("keeps the model's description when every number in it is in the source", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: LOOKED_UP } });
    const d = await fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm([GOOD_REPLY]).llm, now });
    expect(d.description).toBe("A wheel-thrown mug in speckled brown stoneware that holds 16 ounces. Microwave and dishwasher safe.");
  });

  it("drops description sentences with numbers the source does not have", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: LOOKED_UP } });
    const reply = JSON.stringify({
      attributes: [{ source: "Color", name: "glaze" }, { source: "Size", name: "size" }],
      description: "Holds 16 ounces. Fired to 2,300 degrees for 12 hours. Dishwasher safe.",
    });
    const d = await fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm([reply]).llm, now });
    expect(d.description).toBe("Holds 16 ounces. Dishwasher safe.");
    expect(d.warnings).toContainEqual(expect.stringContaining("Fired to 2,300 degrees for 12 hours."));
  });

  it("ignores attributes the source does not have and keeps every option buyers choose", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: LOOKED_UP } });
    const reply = JSON.stringify({
      attributes: [{ source: "Color", name: "Glaze Colour" }, { source: "handle-size", name: "handle" }],
      description: "A stoneware mug.",
    });
    const d = await fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm([reply]).llm, now });
    expect(d.attributesOrder).toEqual(["glaze_colour", "size"]);
    expect(d.variants[0]!.attributes).toEqual({ glaze_colour: "Sand", size: "12 oz" });
  });

  it("sends the source facts to the model as data", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: LOOKED_UP } });
    const s = scriptedLlm([GOOD_REPLY]);
    await fromUrl(PAGE, { channel3: f.c3, llm: s.llm, now, models: { text: "text-model" } });
    const req = s.requests[0]!;
    expect(req.model).toBe("text-model");
    const user = String(req.messages[1]!.content);
    expect(user).toContain("16 ounce capacity");
    expect(user).toContain('"Color"');
    expect(user).toContain("drinkware-material");
  });

  it("fills in facts from Channel3's catalog entry when the page lookup is thin", async () => {
    const thin: C3Product = {
      id: "lkp0001",
      title: "Morning mug",
      offers: [offer("hearth-and-kiln.example", 54)],
      variants: { options: [{ name: "Color", values: [{ label: "Sand" }, { label: "Moss" }] }] },
      structured_attributes: {},
    };
    const canonical: C3Product = {
      id: "cat0001",
      title: "Morning mug",
      description: "Wheel-thrown mug with a 16-ounce capacity.",
      key_features: ["Microwave and dishwasher safe"],
      category: { slug: "mugs", title: "Mugs" },
      offers: [offer("hearth-and-kiln.example", 54)],
      structured_attributes: { "drinkware-material": ["Ceramic"] },
    };
    const f = fakeChannel3({
      byUrl: { [PAGE]: thin },
      byId: { cat0001: canonical },
      search: [
        {
          match: /Morning mug/i,
          products: [
            { id: "zzz", title: "Morning mug", offers: [offer("someone-else.example", 20)] },
            { id: "cat0001", title: "Morning mug", offers: [offer("hearth-and-kiln.example", 54)] },
          ],
        },
      ],
    });
    const s = scriptedLlm([
      JSON.stringify({ attributes: [{ source: "Color", name: "glaze" }], description: "Holds 16 ounces. Microwave and dishwasher safe." }),
    ]);
    const d = await fromUrl(PAGE, { channel3: f.c3, llm: s.llm, now });
    expect(f.fetched.at(-1)).toEqual(["cat0001"]);
    expect(d.category).toBe("mugs");
    expect(d.description).toBe("Holds 16 ounces. Microwave and dishwasher safe.");
    expect(String(s.requests[0]!.messages[1]!.content)).toContain("drinkware-material");
  });

  it("fetches the full catalog entry when the thin lookup already has its id", async () => {
    const thin: C3Product = { id: "cat0001", title: "Morning mug", offers: [offer("hearth-and-kiln.example", 54)], structured_attributes: {} };
    const full: C3Product = { ...thin, description: "Wheel-thrown mug.", category: { slug: "mugs", title: "Mugs" } };
    const f = fakeChannel3({ byUrl: { [PAGE]: thin }, byId: { cat0001: full } });
    const d = await fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm([JSON.stringify({ attributes: [], description: "Wheel-thrown mug." })]).llm, now });
    expect(f.fetched).toEqual([["cat0001"]]);
    expect(f.searches).toEqual([]);
    expect(d.category).toBe("mugs");
  });

  it("records the merchant whose offer priced the draft", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: LOOKED_UP } });
    const d = await fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm([GOOD_REPLY]).llm, now });
    expect(d.source).toEqual({ kind: "url", ref: PAGE, merchant: "hearth-and-kiln.example" });
  });

  it("says so when the price comes from another site than the page", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: { ...LOOKED_UP, offers: [offer("other.example", 50)] } } });
    const d = await fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm([GOOD_REPLY]).llm, now });
    expect(d.variants[0]!.priceCents).toBe(5000);
    expect(d.warnings).toContainEqual(expect.stringMatching(/price.*other\.example.*check/i));
    expect(d.source.merchant).toBe("hearth-and-kiln.example");
  });

  it("treats the retailer behind a Channel3 link as the merchant", async () => {
    const link = "https://buy.trychannel3.com/DeF5678-QrS1-S666bu";
    const f = fakeChannel3({ byUrl: { [link]: { ...LOOKED_UP, offers: [offer("discount-home.example", 2.49)] } } });
    const d = await fromUrl(link, { channel3: f.c3, llm: scriptedLlm([GOOD_REPLY]).llm, now });
    expect(d.source.merchant).toBe("discount-home.example");
    expect(d.warnings.join(" ")).not.toMatch(/discount-home\.example/);
  });

  it("still makes a draft when the model fails", async () => {
    const f = fakeChannel3({ byUrl: { [PAGE]: LOOKED_UP } });
    const d = await fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm(["not json", "still not"]).llm, now });
    expect(d.attributesOrder).toEqual(["color", "size"]);
    expect(d.description).toBe("Wheel-thrown from speckled brown stoneware. Holds 16 ounces. Microwave and dishwasher safe.");
    expect(d.warnings).toContainEqual(expect.stringMatching(/review/i));
  });

  it("warns when the page has no price in dollars", async () => {
    const f = fakeChannel3({
      byUrl: { [PAGE]: { ...LOOKED_UP, offers: [{ ...offer("hearth-and-kiln.example", 50), price: { price: 50, currency: "EUR" } }] } },
    });
    const d = await fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm([GOOD_REPLY]).llm, now });
    expect(d.variants[0]!.priceCents).toBe(0);
    expect(d.warnings).toContainEqual(expect.stringMatching(/set a price/i));
  });

  it("reports pages Channel3 cannot resolve", async () => {
    const f = fakeChannel3({});
    await expect(fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm([]).llm })).rejects.toMatchObject({ code: "not_found" });
    await expect(fromUrl("ftp://x", { channel3: f.c3, llm: scriptedLlm([]).llm })).rejects.toBeInstanceOf(ImportError);
  });

  it("reports pages that are not product pages", async () => {
    const f = fakeChannel3({});
    f.c3.lookup = async () => {
      throw new Channel3Error("nope", "not_a_product_page", 422);
    };
    await expect(fromUrl(PAGE, { channel3: f.c3, llm: scriptedLlm([]).llm })).rejects.toMatchObject({
      name: "ImportError",
      code: "not_a_product_page",
    });
  });
});
