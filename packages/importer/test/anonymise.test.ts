import { describe, expect, it } from "vitest";
import type { ProductDraft } from "../src/types";
import { Anonymiser } from "./anonymise";

const PRODUCT = {
  id: "Zq81kPa",
  title: "The Lantern Mug",
  brands: [{ id: "b1", name: "Kilnside Pottery" }],
  images: [{ url: "https://cdn.trychannel3.com/abc?aid=1", is_main_image: true }],
  offers: [{ url: "https://buy.trychannel3.com/Zq81kPa-Ab12-S666bu", domain: "kilnside-pottery.test", price: { price: 48, currency: "USD" }, availability: "InStock" }],
  key_features: ["16 ounce capacity"],
};

const DRAFT: ProductDraft = {
  parentId: "LANTERN-MUG",
  name: "The Lantern Mug",
  category: "mugs",
  description: "A 16 ounce mug from Kilnside Pottery.",
  attributesOrder: ["color"],
  variants: [
    { variantId: "LANTERN-MUG-SAND", attributes: { color: "Sand", material: "Ceramic" }, priceCents: 4800, stock: 0, floorCents: 4050, flags: [], purchasable: true, leadTimeDays: 0 },
    { variantId: "LANTERN-MUG-EMBERGLOW", attributes: { color: "Emberglow", material: "Ceramic" }, priceCents: 5000, stock: 0, floorCents: 4250, flags: [], purchasable: true, leadTimeDays: 0 },
  ],
  source: { kind: "url", ref: "https://kilnside-pottery.test/products/the-lantern-mug", merchant: "kilnside-pottery.test" },
  warnings: ["The price comes from kilnside-pottery.test, not from this page: check it."],
};

describe("Anonymiser", () => {
  it("replaces names, domains, ids, links and images but keeps shape and numbers", () => {
    const a = new Anonymiser();
    a.learn(PRODUCT);
    const out = { lookup: a.skeleton(PRODUCT), draft: a.draft(DRAFT) };
    expect(() => a.assertClean(out)).not.toThrow();
    expect(out.lookup).toEqual({
      id: "prod001",
      title: "<text 15>",
      brands: [{ id: "prod002", name: "<text 16>" }],
      images: [{ url: "https://images.example/1.jpg", is_main_image: true }],
      offers: [{ url: "https://buy.trychannel3.com/prod001", domain: "shop-1.example", price: { price: 48, currency: "USD" }, availability: "InStock" }],
      key_features: ["<text 17>"],
    });
    expect(out.draft).toMatchObject({
      parentId: "PRODUCT-A",
      name: "Product A",
      description: "A 16 ounce mug from Brand 1.",
      // The shop's own option names could identify it; shared attributes stay.
      variants: [
        { variantId: "PRODUCT-A-COLOR-1", attributes: { color: "color 1", material: "Ceramic" }, priceCents: 4800, floorCents: 4050 },
        { variantId: "PRODUCT-A-COLOR-2", attributes: { color: "color 2", material: "Ceramic" }, priceCents: 5000, floorCents: 4250 },
      ],
      source: { ref: "https://shop-1.example/products/item", merchant: "shop-1.example" },
      warnings: ["The price comes from shop-1.example, not from this page: check it."],
    });
  });

  it("refuses output that still names the merchant", () => {
    const a = new Anonymiser();
    a.learn(PRODUCT);
    expect(() => a.assertClean({ note: "bought at kilnside-pottery.test" })).toThrow(/kilnside-pottery/);
  });
});
