import { describe, expect, it } from "vitest";
import { attributeKey, cleanUrl, keepSupportedSentences, parseMoneyCents, slug } from "../src/text";

describe("slug", () => {
  it("uppercases and hyphenates", () => {
    expect(slug("Speckled mug")).toBe("SPECKLED-MUG");
    expect(slug("12 oz")).toBe("12-OZ");
  });

  it("folds accents and drops punctuation", () => {
    expect(slug("Café crème — 1/2 lb.")).toBe("CAFE-CREME-1-2-LB");
  });

  it("keeps decimals readable", () => {
    expect(slug("4.5 in")).toBe("4-5-IN");
  });

  it("trims long values at a word boundary", () => {
    expect(slug("a very long product name that goes on and on forever", 20)).toBe("A-VERY-LONG-PRODUCT");
  });

  it("is empty for text without letters or digits", () => {
    expect(slug(" — ")).toBe("");
  });
});

describe("attributeKey", () => {
  it("makes snake_case keys", () => {
    expect(attributeKey("Option1 Value")).toBe("option1_value");
    expect(attributeKey("Dye lot")).toBe("dye_lot");
    expect(attributeKey("drinkware-material")).toBe("drinkware_material");
    expect(attributeKey("Colour/Glaze")).toBe("colour_glaze");
  });
});

describe("cleanUrl", () => {
  it("drops tracking parameters and the fragment", () => {
    expect(
      cleanUrl("https://shop.example/products/mug?utm_source=x&gclid=1&fbclid=2&variant=42&ref=home#reviews"),
    ).toBe("https://shop.example/products/mug?variant=42");
  });

  it("drops click ids on Channel3 buy links", () => {
    expect(cleanUrl("https://buy.trychannel3.com/AbC1234-XyZ9-S666bu?o=01M0MP&aid=01M6ZB")).toBe(
      "https://buy.trychannel3.com/AbC1234-XyZ9-S666bu",
    );
  });

  it("rejects anything that is not an http(s) URL", () => {
    expect(() => cleanUrl("javascript:alert(1)")).toThrow(/http/);
    expect(() => cleanUrl("not a url")).toThrow();
  });
});

describe("keepSupportedSentences", () => {
  const source = "Holds 16 oz. Height 4.5 in. Dishwasher safe. Ceramic, made in 2019. Price 1,250.00";

  it("keeps sentences whose numbers all appear in the source", () => {
    const r = keepSupportedSentences("A 16 oz mug, 4.5 in tall. Dishwasher safe.", source);
    expect(r.text).toBe("A 16 oz mug, 4.5 in tall. Dishwasher safe.");
    expect(r.dropped).toEqual([]);
  });

  it("drops a sentence with a number the source does not have", () => {
    const r = keepSupportedSentences("A 16 oz mug. Fired at 2300 degrees. Dishwasher safe.", source);
    expect(r.text).toBe("A 16 oz mug. Dishwasher safe.");
    expect(r.dropped).toEqual(["Fired at 2300 degrees."]);
  });

  it("compares numbers by value, not spelling", () => {
    expect(keepSupportedSentences("Height 4.50 in.", source).dropped).toEqual([]);
    expect(keepSupportedSentences("Costs 1250 at most.", source).dropped).toEqual([]);
  });

  it("checks digits inside words and ranges", () => {
    expect(keepSupportedSentences("Holds 12-16 oz.", source).dropped).toEqual(["Holds 12-16 oz."]);
    expect(keepSupportedSentences("A 16oz mug.", source).dropped).toEqual([]);
  });

  it("does not split on decimal points", () => {
    expect(keepSupportedSentences("It is 4.5 in tall and holds 16 oz.", source).text).toBe(
      "It is 4.5 in tall and holds 16 oz.",
    );
  });
});

describe("parseMoneyCents", () => {
  it("reads common price spellings", () => {
    expect(parseMoneyCents("34")).toBe(3400);
    expect(parseMoneyCents("34.5")).toBe(3450);
    expect(parseMoneyCents("$1,234.99")).toBe(123499);
    expect(parseMoneyCents(" 12.00 USD ")).toBe(1200);
  });

  it("is undefined for blanks and nonsense", () => {
    expect(parseMoneyCents("")).toBeUndefined();
    expect(parseMoneyCents("call us")).toBeUndefined();
    expect(parseMoneyCents("-3")).toBeUndefined();
  });
});
