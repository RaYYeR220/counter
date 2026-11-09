import { describe, it, expect } from "vitest";
import { PayPalCartSchema } from "@paypal/commerce-cart-zod";
import {
  assembleCart,
  computeCart,
  MemoryCatalog,
  type ComputedCart,
  type PayPalCart,
} from "../src/index";
import {
  BOWL,
  CATALOG,
  MUG,
  NEW_YORK,
  NOW,
  OOS,
  PORTLAND,
  RETIRED,
  SAN_JOSE,
  SHOP,
  SYDNEY,
  TEE,
  cartBody,
  line,
} from "./fixtures";

const catalog = new MemoryCatalog(CATALOG);

function compute(body: PayPalCart, opts: Partial<Parameters<typeof computeCart>[3]> = {}) {
  return computeCart(body, catalog, SHOP, { now: NOW, ...opts });
}

function assembled(body: PayPalCart, c: ComputedCart) {
  return assembleCart(body, c, {
    id: "CART-TEST000001",
    status: c.validationStatus === "VALID" ? "CREATED" : "INCOMPLETE",
    paymentMethod: c.validationStatus === "VALID" ? { type: "paypal", token: "ORDER-1" } : undefined,
  });
}

function expectStrictCart(cart: unknown) {
  const res = PayPalCartSchema.strict().safeParse(cart);
  if (!res.success) throw new Error(JSON.stringify(res.error.issues, null, 2));
}

describe("computeCart: pricing", () => {
  it("prices items from the catalog and sums the subtotal to the cent", async () => {
    const body = cartBody({ items: [line(MUG, 2), line(TEE, 1), line(BOWL, 3)] });
    const c = await compute(body);
    expect(c.validationStatus).toBe("VALID");
    expect(c.issues).toEqual([]);
    expect(c.items.map((i) => i.price.value)).toEqual(["25.00", "18.00", "32.00"]);
    expect(c.totals.subtotal).toEqual({ currency_code: "USD", value: "164.00" });
  });

  it("ignores prices, names and urls supplied in the request", async () => {
    const body = cartBody({
      items: [{ ...line(MUG), price: { currency_code: "USD", value: "0.01" }, name: "Free mug", item_url: "x" }],
    });
    const c = await compute(body);
    expect(c.items[0]).toMatchObject({
      variant_id: "MUG-BLU-12",
      parent_id: "MUG",
      name: MUG.name,
      item_url: MUG.url,
      price: { currency_code: "USD", value: "25.00" },
    });
    expect(c.totals.subtotal!.value).toBe("25.00");
  });

  it("carries catalog attributes as selected attributes", async () => {
    const c = await compute(cartBody());
    expect(c.items[0]!.selected_attributes).toEqual([
      { name: "color", value: "Blue" },
      { name: "size", value: "12 oz" },
    ]);
  });

  it("falls back to parent_id when variant_id is absent", async () => {
    const c = await compute(cartBody({ items: [{ parent_id: "BOWL-SAGE", quantity: 1 }] }));
    expect(c.issues).toEqual([]);
    expect(c.items[0]!.variant_id).toBe("BOWL-SAGE");
  });

  it("charges CA tax at 7.25% on subtotal plus shipping, half-up", async () => {
    const c = await compute(cartBody());
    // 25.00 + 5.99 = 30.99 -> 2.246775 -> 2.25
    expect(c.totals).toEqual({
      subtotal: { currency_code: "USD", value: "25.00" },
      shipping: { currency_code: "USD", value: "5.99" },
      tax: { currency_code: "USD", value: "2.25" },
      total: { currency_code: "USD", value: "33.24" },
    });
  });

  it("charges no tax in Oregon", async () => {
    const c = await compute(cartBody({ shipping_address: PORTLAND }));
    expect(c.totals.tax).toEqual({ currency_code: "USD", value: "0.00" });
    expect(c.totals.total!.value).toBe("30.99");
  });

  it("ships STANDARD free from a $75 subtotal", async () => {
    const c = await compute(cartBody({ items: [line(MUG, 3)] }));
    expect(c.totals.shipping!.value).toBe("0.00");
    expect(c.shipping.find((o) => o.id === "STANDARD")!.price.value).toBe("0.00");
  });
});

describe("computeCart: shipping options", () => {
  it("offers both options with STANDARD selected by default", async () => {
    const c = await compute(cartBody());
    expect(c.shipping).toEqual([
      {
        id: "STANDARD",
        name: "Standard",
        description: "Arrives in about 5 business days",
        price: { currency_code: "USD", value: "5.99" },
        is_selected: true,
        estimated_delivery: "2026-11-16",
      },
      {
        id: "EXPRESS",
        name: "Express",
        description: "Arrives in about 2 business days",
        price: { currency_code: "USD", value: "14.99" },
        is_selected: false,
        estimated_delivery: "2026-11-11",
      },
    ]);
  });

  it("honours the client's selection by id", async () => {
    const first = await compute(cartBody());
    const flipped = first.shipping.map((o) => ({ ...o, is_selected: o.id === "EXPRESS" }));
    const c = await compute(cartBody({ shipping_address: NEW_YORK, available_shipping_options: flipped }));
    expect(c.shipping.filter((o) => o.is_selected).map((o) => o.id)).toEqual(["EXPRESS"]);
    expect(c.totals.shipping!.value).toBe("14.99");
  });

  it("ignores client-sent shipping prices", async () => {
    const c = await compute(
      cartBody({
        available_shipping_options: [
          { id: "EXPRESS", name: "Express", price: { currency_code: "USD", value: "0.00" }, is_selected: true },
        ],
      }),
    );
    expect(c.totals.shipping!.value).toBe("14.99");
  });

  it("falls back to STANDARD when the selected id is not offered", async () => {
    const c = await compute(
      cartBody({
        available_shipping_options: [
          { id: "OVERNIGHT", name: "Overnight", price: { currency_code: "USD", value: "40.00" }, is_selected: true },
        ],
      }),
    );
    expect(c.shipping.filter((o) => o.is_selected).map((o) => o.id)).toEqual(["STANDARD"]);
    expect(c.issues).toEqual([]);
  });

  it("selects exactly one option even when the client marks several", async () => {
    const first = await compute(cartBody());
    const all = first.shipping.map((o) => ({ ...o, is_selected: true }));
    const c = await compute(cartBody({ available_shipping_options: all }));
    expect(c.shipping.filter((o) => o.is_selected)).toHaveLength(1);
  });
});

describe("computeCart: validation issues", () => {
  it("flags an unknown variant as DATA_ERROR / ITEM_NOT_FOUND and echoes it at zero", async () => {
    const body = cartBody({ items: [line(MUG), { parent_id: "NOPE", variant_id: "NOPE-1", quantity: 2 }] });
    const c = await compute(body);
    expect(c.validationStatus).toBe("INVALID");
    expect(c.issues).toHaveLength(1);
    expect(c.issues[0]).toMatchObject({
      code: "DATA_ERROR",
      type: "INVALID_DATA",
      variant_id: "NOPE-1",
      context: { specific_issue: "ITEM_NOT_FOUND" },
      resolution_options: [expect.objectContaining({ action: "REMOVE_ITEM" })],
    });
    expect(c.items[1]).toMatchObject({ variant_id: "NOPE-1", quantity: 2, price: { value: "0.00" } });
    expect(c.totals.subtotal!.value).toBe("25.00");
    expect(c.resolvedCount).toBe(1);
  });

  it("flags stock 0 as INVENTORY_ISSUE / ITEM_OUT_OF_STOCK", async () => {
    const c = await compute(cartBody({ items: [line(OOS, 2)] }));
    expect(c.validationStatus).toBe("INVALID");
    expect(c.issues[0]).toMatchObject({
      code: "INVENTORY_ISSUE",
      type: "BUSINESS_RULE",
      variant_id: OOS.variantId,
      context: { specific_issue: "ITEM_OUT_OF_STOCK", available_quantity: 0, requested_quantity: 2 },
      resolution_options: [expect.objectContaining({ action: "REMOVE_ITEM" })],
    });
    // still priced, so items x price == subtotal
    expect(c.totals.subtotal!.value).toBe("50.00");
  });

  it("flags quantity above stock as INSUFFICIENT_INVENTORY", async () => {
    const c = await compute(cartBody({ items: [line(BOWL, 7)] }));
    expect(c.issues[0]).toMatchObject({
      code: "INVENTORY_ISSUE",
      context: { specific_issue: "INSUFFICIENT_INVENTORY", available_quantity: 5, requested_quantity: 7 },
    });
    expect(c.issues[0]!.resolution_options!.map((r) => r.action)).toEqual(["MODIFY_CART", "REMOVE_ITEM"]);
  });

  it("checks stock against the combined quantity of repeated lines", async () => {
    const c = await compute(cartBody({ items: [line(BOWL, 3), line(BOWL, 3)] }));
    expect(c.issues.map((i) => i.context?.specific_issue)).toContain("INSUFFICIENT_INVENTORY");
  });

  it("flags an inactive product as discontinued", async () => {
    const c = await compute(cartBody({ items: [line(RETIRED)] }));
    expect(c.issues[0]).toMatchObject({
      code: "INVENTORY_ISSUE",
      variant_id: RETIRED.variantId,
      context: { specific_issue: "ITEM_DISCONTINUED" },
    });
  });

  it("asks for a shipping address when none is given", async () => {
    const { shipping_address: _drop, ...noAddress } = cartBody();
    const c = await compute(noAddress);
    expect(c.validationStatus).toBe("REQUIRES_ADDITIONAL_INFORMATION");
    expect(c.issues).toHaveLength(1);
    expect(c.issues[0]).toMatchObject({
      type: "MISSING_FIELD",
      field: "shipping_address",
      context: { specific_issue: "MISSING_SHIPPING_ADDRESS" },
    });
    expect(c.shipping).toEqual([]);
    expect(c.totals.shipping!.value).toBe("0.00");
    expect(c.totals.tax!.value).toBe("0.00");
  });

  it("refuses international addresses with INTERNATIONAL_SHIPPING_RESTRICTED", async () => {
    const c = await compute(cartBody({ shipping_address: SYDNEY }));
    expect(c.validationStatus).toBe("INVALID");
    expect(c.issues[0]).toMatchObject({
      code: "SHIPPING_ERROR",
      context: {
        specific_issue: "INTERNATIONAL_SHIPPING_RESTRICTED",
        destination_country: "AU",
        supported_countries: ["US"],
      },
      resolution_options: [expect.objectContaining({ action: "UPDATE_ADDRESS" })],
    });
    expect(c.shipping).toEqual([]);
  });

  it("is INVALID, not REQUIRES_ADDITIONAL_INFORMATION, when other problems exist too", async () => {
    const { shipping_address: _drop, ...noAddress } = cartBody({ items: [line(OOS)] });
    const c = await compute(noAddress);
    expect(c.validationStatus).toBe("INVALID");
  });
});

describe("computeCart: discounts", () => {
  it("applies discounts, reports them and taxes the discounted base", async () => {
    const c = await compute(cartBody({ items: [line(MUG, 2)] }), {
      discounts: [{ code: "BUNDLE10", amountCents: 500, description: "Two-mug bundle" }],
    });
    expect(c.discounts).toEqual({
      codes: ["BUNDLE10"],
      applied: [
        {
          code: "BUNDLE10",
          title: "Two-mug bundle",
          amount: { currency_code: "USD", value: "5.00" },
          automatic: false,
          method: "ACROSS",
        },
      ],
    });
    // 50.00 - 5.00 + 5.99 = 50.99 -> tax 3.696775 -> 3.70 -> total 54.69
    expect(c.totals).toEqual({
      subtotal: { currency_code: "USD", value: "50.00" },
      discount: { currency_code: "USD", value: "5.00" },
      shipping: { currency_code: "USD", value: "5.99" },
      tax: { currency_code: "USD", value: "3.70" },
      total: { currency_code: "USD", value: "54.69" },
    });
  });

  it("allocates an item discount to its line", async () => {
    const c = await compute(cartBody({ items: [line(TEE), line(MUG)] }), {
      discounts: [{ code: "MUGDEAL", variantId: MUG.variantId, amountCents: 250, description: "Mug deal" }],
    });
    expect(c.discounts!.applied[0]).toMatchObject({
      method: "EACH",
      allocations: [{ path: "items[1]", amount: { currency_code: "USD", value: "2.50" } }],
    });
  });

  it("drops an item discount whose item is no longer in the cart", async () => {
    const c = await compute(cartBody({ items: [line(TEE)] }), {
      discounts: [{ code: "MUGDEAL", variantId: MUG.variantId, amountCents: 250, description: "Mug deal" }],
    });
    expect(c.discounts).toBeUndefined();
    expect(c.totals.discount).toBeUndefined();
  });

  it("never discounts below zero", async () => {
    const c = await compute(cartBody({ items: [line(TEE)] }), {
      discounts: [{ code: "HUGE", amountCents: 999_99, description: "Too generous" }],
    });
    expect(c.totals.discount!.value).toBe("18.00");
    expect(c.amounts.total).toBeGreaterThanOrEqual(0);
  });

  it("rejects a requested code it cannot apply", async () => {
    const c = await compute(cartBody({ discounts: { codes: ["NOPE"] } }));
    expect(c.validationStatus).toBe("INVALID");
    expect(c.issues[0]).toMatchObject({
      code: "DISCOUNT_ERROR",
      context: { specific_issue: "DISCOUNT_CODE_INVALID" },
    });
  });

  it("does not flag a requested code that was applied", async () => {
    const c = await compute(cartBody({ discounts: { codes: ["BUNDLE10"] } }), {
      discounts: [{ code: "BUNDLE10", amountCents: 100, description: "Bundle" }],
    });
    expect(c.issues).toEqual([]);
  });
});

describe("assembleCart", () => {
  it("produces a strictly valid PayPalCart for every case", async () => {
    const { shipping_address: _drop, ...noAddress } = cartBody();
    const bodies: PayPalCart[] = [
      cartBody(),
      cartBody({ items: [line(MUG), line(OOS), { parent_id: "X", variant_id: "X-1", quantity: 1 }] }),
      cartBody({ shipping_address: SYDNEY }),
      noAddress,
      cartBody({ items: [line(BOWL, 9)], shipping_address: PORTLAND }),
    ];
    for (const body of bodies) {
      const c = await compute(body, {
        discounts: [{ code: "D1", amountCents: 100, description: "Thanks" }],
      });
      expectStrictCart(assembled(body, c));
    }
  });

  it("echoes customer and addresses exactly and omits payment_method without a token", async () => {
    const body = cartBody({ items: [line(OOS)] });
    const c = await compute(body);
    const out = assembled(body, c);
    expect(out.customer).toEqual(body.customer);
    expect(out.shipping_address).toEqual(SAN_JOSE);
    expect(out.billing_address).toEqual(body.billing_address);
    expect(out).not.toHaveProperty("payment_method");
    expect(out.status).toBe("INCOMPLETE");
    expect(out.id).toBe("CART-TEST000001");
  });
});
