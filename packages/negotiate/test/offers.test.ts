import { describe, expect, it } from "vitest";
import { computeCart, MemoryCatalog, type CatalogVariant, type PayPalCart } from "@counter/store-sync";
import { evaluate, type ShopPolicy } from "../src/engine";
import { MemoryOfferStore, OfferBook, OfferDiscounts, type OfferDeal } from "../src/offers";

const SHOP = "juniper-clay";
const AGENT = "agent-platform-a";
const NOW = new Date("2026-11-09T15:00:00Z");
const TTL = 30 * 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const SAGE12 = "JC-MUG-SPECKLE-SAGE-12";
const INK8 = "JC-MUG-SPECKLE-INK-8";
const BOWL6 = "JC-BOWL-EVERYDAY-SAGE-6";

/** 3 sage mugs at $29.00 (list $34.00) and one ink mug at list $30.00: $15.00 off. */
const DEAL: OfferDeal = {
  lines: [
    { variantId: SAGE12, quantity: 3, unitCents: 2900, listCents: 3400 },
    { variantId: INK8, quantity: 1, unitCents: 3000, listCents: 3000 },
  ],
  discountCents: 1500,
};

function book(ids: string[] = ["OFF-AAAAAAAA", "OFF-BBBBBBBB", "OFF-CCCCCCCC"]) {
  const queue = [...ids];
  return new OfferBook({ store: new MemoryOfferStore(), newId: () => queue.shift()! });
}

describe("OfferBook.issue", () => {
  it("records the deal for one agent at one shop until it expires", async () => {
    const offer = await book().issue(SHOP, AGENT, DEAL, TTL, NOW);
    expect(offer).toEqual({
      id: "OFF-AAAAAAAA",
      shopId: SHOP,
      agentClient: AGENT,
      lines: DEAL.lines,
      discountCents: 1500,
      createdAt: NOW,
      expiresAt: at(TTL),
    });
  });

  it("makes ids shaped OFF-XXXXXXXX by default", async () => {
    const b = new OfferBook();
    const a = await b.issue(SHOP, AGENT, DEAL, TTL, NOW);
    const c = await b.issue(SHOP, AGENT, DEAL, TTL, NOW);
    expect(a.id).toMatch(/^OFF-[A-Z0-9]{8}$/);
    expect(c.id).not.toBe(a.id);
  });

  it("does not issue a deal without a discount, or one whose total disagrees with its lines", async () => {
    const b = book();
    await expect(b.issue(SHOP, AGENT, { lines: [DEAL.lines[1]!], discountCents: 0 }, TTL, NOW)).rejects.toThrow(RangeError);
    await expect(b.issue(SHOP, AGENT, { ...DEAL, discountCents: 2000 }, TTL, NOW)).rejects.toThrow(RangeError);
    await expect(b.issue(SHOP, AGENT, DEAL, 0, NOW)).rejects.toThrow(RangeError);
  });

  it("issues what the engine returns", async () => {
    const policy: ShopPolicy = { enabled: true, maxDiscountPct: 15, bundleMinItems: 3 };
    const e = evaluate([{ variantId: SAGE12, quantity: 3, listCents: 3400, floorCents: 2900, stock: 6 }], policy, {
      percentOff: 10,
    });
    const offer = await book().issue(SHOP, AGENT, e, TTL, NOW);
    expect(offer.discountCents).toBe(1020);
  });
});

describe("OfferBook.discountsFor", () => {
  async function issued() {
    const b = book();
    const offer = await b.issue(SHOP, AGENT, DEAL, TTL, NOW);
    return { b, offer };
  }

  it("discounts only the offered lines, coded with the offer id", async () => {
    const { b } = await issued();
    const d = await b.discountsFor(SHOP, AGENT, [
      { variantId: SAGE12, quantity: 3 },
      { variantId: INK8, quantity: 1 },
      { variantId: BOWL6, quantity: 2 },
    ], at(1000), ["OFF-AAAAAAAA"]);
    expect(d).toEqual([{ code: "OFF-AAAAAAAA", variantId: SAGE12, amountCents: 1500, description: "Negotiated price" }]);
  });

  it("expires at expiresAt", async () => {
    const { b } = await issued();
    const cart = [{ variantId: SAGE12, quantity: 3 }, { variantId: INK8, quantity: 1 }];
    expect(await b.discountsFor(SHOP, AGENT, cart, at(TTL - 1), ["OFF-AAAAAAAA"])).toHaveLength(1);
    expect(await b.discountsFor(SHOP, AGENT, cart, at(TTL), ["OFF-AAAAAAAA"])).toEqual([]);
  });

  it("is bound to the agent client and the shop", async () => {
    const { b } = await issued();
    const cart = [{ variantId: SAGE12, quantity: 3 }, { variantId: INK8, quantity: 1 }];
    expect(await b.discountsFor(SHOP, "another-agent", cart, NOW, ["OFF-AAAAAAAA"])).toEqual([]);
    expect(await b.discountsFor("northpaw-roasters", AGENT, cart, NOW, ["OFF-AAAAAAAA"])).toEqual([]);
  });

  it("needs every offered line with at least the offered quantity", async () => {
    const { b } = await issued();
    expect(await b.discountsFor(SHOP, AGENT, [{ variantId: SAGE12, quantity: 2 }, { variantId: INK8, quantity: 1 }], NOW, ["OFF-AAAAAAAA"])).toEqual([]);
    // The ink mug carries no discount, but it is part of the bundle the deal was priced for.
    expect(await b.discountsFor(SHOP, AGENT, [{ variantId: SAGE12, quantity: 3 }], NOW, ["OFF-AAAAAAAA"])).toEqual([]);
  });

  it("discounts only the offered quantity when the cart holds more", async () => {
    const { b } = await issued();
    const d = await b.discountsFor(SHOP, AGENT, [{ variantId: SAGE12, quantity: 5 }, { variantId: INK8, quantity: 1 }], NOW, ["OFF-AAAAAAAA"]);
    expect(d.map((x) => x.amountCents)).toEqual([1500]);
  });

  it("adds up a variant split across cart lines", async () => {
    const { b } = await issued();
    const d = await b.discountsFor(SHOP, AGENT, [
      { variantId: SAGE12, quantity: 1 },
      { variantId: INK8, quantity: 1 },
      { variantId: SAGE12, quantity: 2 },
    ], NOW, ["OFF-AAAAAAAA"]);
    expect(d).toHaveLength(1);
  });

  it("applies one offer per cart: the largest one that still matches", async () => {
    const b = book();
    const small: OfferDeal = { lines: [{ variantId: SAGE12, quantity: 1, unitCents: 3230, listCents: 3400 }], discountCents: 170 };
    await b.issue(SHOP, AGENT, small, TTL, NOW);
    await b.issue(SHOP, AGENT, DEAL, TTL, NOW);
    const both = await b.discountsFor(SHOP, AGENT, [{ variantId: SAGE12, quantity: 3 }, { variantId: INK8, quantity: 1 }], NOW, ["OFF-AAAAAAAA", "OFF-BBBBBBBB"]);
    expect(both.map((x) => x.code)).toEqual(["OFF-BBBBBBBB"]);
    const onlySmall = await b.discountsFor(SHOP, AGENT, [{ variantId: SAGE12, quantity: 1 }], NOW, ["OFF-AAAAAAAA", "OFF-BBBBBBBB"]);
    expect(onlySmall).toEqual([{ code: "OFF-AAAAAAAA", variantId: SAGE12, amountCents: 170, description: "Negotiated price" }]);
  });
});

describe("OfferBook.discountsFor: codes", () => {
  it("applies nothing unless the cart asks for the offer by id", async () => {
    const b = book();
    await b.issue(SHOP, AGENT, DEAL, TTL, NOW);
    const cart = [{ variantId: SAGE12, quantity: 3 }, { variantId: INK8, quantity: 1 }];
    expect(await b.discountsFor(SHOP, AGENT, cart, NOW, [])).toEqual([]);
    expect(await b.discountsFor(SHOP, AGENT, cart, NOW, ["OFF-ZZZZZZZZ"])).toEqual([]);
    expect(await b.discountsFor(SHOP, AGENT, cart, NOW, ["off-aaaaaaaa"])).toHaveLength(1);
  });
});

describe("OfferDiscounts", () => {
  const variant = (variantId: string, priceCents: number, stock: number): CatalogVariant => ({
    variantId,
    parentId: variantId.split("-").slice(0, 3).join("-"),
    name: variantId,
    url: `https://juniper.example/p/${variantId.toLowerCase()}`,
    priceCents,
    stock,
    attributes: {},
    active: true,
  });
  const catalog = new MemoryCatalog({ [SHOP]: [variant(SAGE12, 3400, 6), variant(INK8, 3000, 7), variant(BOWL6, 2800, 10)] });
  const cart = (items: [string, number][]): PayPalCart => ({
    items: items.map(([variant_id, quantity]) => ({ variant_id, quantity })),
    shipping_address: { address_line_1: "2148 Linden St", admin_area_2: "Portland", admin_area_1: "OR", postal_code: "97214", country_code: "US" },
    payment_method: { type: "paypal" },
  });

  it("feeds the negotiated price into the Store Sync cart totals", async () => {
    const b = book();
    await b.issue(SHOP, AGENT, DEAL, TTL, NOW);
    const port = new OfferDiscounts(b, () => at(60_000));
    const body = { ...cart([[SAGE12, 3], [INK8, 1], [BOWL6, 1]]), discounts: { codes: ["OFF-AAAAAAAA"] } };
    const discounts = await port.forCart(SHOP, { cartId: "CART-TEST000001", cart: body, agentClient: AGENT });
    const c = await computeCart(body, catalog, SHOP, { now: NOW, discounts });
    expect(c.amounts.subtotal).toBe(3 * 3400 + 3000 + 2800);
    expect(c.amounts.discount).toBe(1500);
    expect(c.discounts?.applied).toEqual([
      expect.objectContaining({ code: "OFF-AAAAAAAA", method: "EACH", amount: { currency_code: "USD", value: "15.00" } }),
    ]);
  });

  it("grants nothing to a cart that does not carry the offer's code", async () => {
    const b = book();
    await b.issue(SHOP, AGENT, DEAL, TTL, NOW);
    const port = new OfferDiscounts(b, () => NOW);
    expect(await port.forCart(SHOP, { cartId: undefined, cart: cart([[SAGE12, 3], [INK8, 1]]), agentClient: AGENT })).toEqual([]);
  });

  it("grants nothing to a cart without an agent client", async () => {
    const b = book();
    await b.issue(SHOP, AGENT, DEAL, TTL, NOW);
    const port = new OfferDiscounts(b, () => NOW);
    expect(await port.forCart(SHOP, { cartId: undefined, cart: cart([[SAGE12, 3], [INK8, 1]]), agentClient: undefined })).toEqual([]);
  });
});
