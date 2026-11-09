import { describe, it, expect } from "vitest";
import { PayPal, PayPalApiError, type Breakdown, type OrderItem } from "../src/index";
import { ENV, MERCHANT, expectedAssertion, fakePayPal } from "./fake";

const SHIPPING = {
  fullName: "John Doe",
  address: {
    line1: "456 Fictional St",
    line2: "Apt 4B",
    city: "San Jose",
    state: "CA",
    postalCode: "90210",
    countryCode: "US",
  },
};

describe("patchOrder", () => {
  const NEW_AMOUNT: Breakdown = { currency: "USD", total: "57.80", itemTotal: "50.00", shipping: "5.99", taxTotal: "1.81" };
  const NEW_ITEMS: OrderItem[] = [{ name: "Black Tee (M)", quantity: 2, unitAmount: "25.00", sku: "TEE-BLK-M" }];

  it("replaces items and amount on the default purchase unit", async () => {
    const pp = fakePayPal({ "PATCH /v2/checkout/orders/ORD1": { status: 204 } });
    const out = await new PayPal(ENV, pp.fetch).patchOrder("ORD1", undefined, NEW_AMOUNT, NEW_ITEMS);

    expect(out).toBe("ok");
    const req = pp.last();
    expect(req.method).toBe("PATCH");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD1");
    expect(req.json()).toEqual([
      {
        op: "replace",
        path: "/purchase_units/@reference_id=='default'/items",
        value: [
          { name: "Black Tee (M)", quantity: "2", sku: "TEE-BLK-M", unit_amount: { currency_code: "USD", value: "25.00" } },
        ],
      },
      {
        op: "replace",
        path: "/purchase_units/@reference_id=='default'/amount",
        value: {
          currency_code: "USD",
          value: "57.80",
          breakdown: {
            item_total: { currency_code: "USD", value: "50.00" },
            shipping: { currency_code: "USD", value: "5.99" },
            tax_total: { currency_code: "USD", value: "1.81" },
          },
        },
      },
    ]);
    expect(req.headers.has("paypal-auth-assertion")).toBe(false);
    expect(req.headers.has("paypal-partner-attribution-id")).toBe(false);
  });

  it("acts for the merchant with assertion and attribution headers", async () => {
    const pp = fakePayPal({ "PATCH /v2/checkout/orders/ORD1": { status: 204 } });
    await new PayPal(ENV, pp.fetch).patchOrder("ORD1", MERCHANT, NEW_AMOUNT, NEW_ITEMS);
    const h = pp.last().headers;
    expect(h.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(h.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("also replaces the shipping address when one is passed", async () => {
    const pp = fakePayPal({ "PATCH /v2/checkout/orders/ORD1": { status: 204 } });
    await new PayPal(ENV, pp.fetch).patchOrder("ORD1", undefined, NEW_AMOUNT, NEW_ITEMS, SHIPPING);
    expect(pp.last().json()[2]).toEqual({
      op: "replace",
      path: "/purchase_units/@reference_id=='default'/shipping/address",
      value: {
        address_line_1: "456 Fictional St",
        address_line_2: "Apt 4B",
        admin_area_2: "San Jose",
        admin_area_1: "CA",
        postal_code: "90210",
        country_code: "US",
      },
    });
  });

  it("reports an order PayPal no longer knows as expired", async () => {
    const pp = fakePayPal({
      "PATCH /v2/checkout/orders/GONE": {
        status: 404,
        json: {
          name: "RESOURCE_NOT_FOUND",
          details: [{ issue: "INVALID_RESOURCE_ID", description: "Specified resource ID does not exist." }],
          message: "The specified resource does not exist.",
        },
      },
    });
    expect(await new PayPal(ENV, pp.fetch).patchOrder("GONE", undefined, NEW_AMOUNT, NEW_ITEMS)).toBe("expired");
  });

  it.each([
    "ORDER_ALREADY_COMPLETED",
    "ORDER_COMPLETED_OR_VOIDED",
    "ORDER_EXPIRED",
    "AMOUNT_CHANGE_NOT_ALLOWED",
    "AMOUNT_NOT_PATCHABLE",
  ])("reports 422 %s as expired so the caller opens a fresh order", async (issue) => {
    const pp = fakePayPal({
      "PATCH /v2/checkout/orders/ORD1": {
        status: 422,
        json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue }], message: "nope" },
      },
    });
    expect(await new PayPal(ENV, pp.fetch).patchOrder("ORD1", undefined, NEW_AMOUNT, NEW_ITEMS)).toBe("expired");
  });

  it("throws on other validation failures instead of hiding them", async () => {
    const pp = fakePayPal({
      "PATCH /v2/checkout/orders/ORD1": {
        status: 422,
        json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ITEM_TOTAL_MISMATCH" }], message: "nope" },
      },
    });
    const err = await new PayPal(ENV, pp.fetch)
      .patchOrder("ORD1", undefined, NEW_AMOUNT, NEW_ITEMS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).issue).toBe("ITEM_TOTAL_MISMATCH");
  });

  it("checks the breakdown before calling PayPal", async () => {
    const pp = fakePayPal({ "PATCH /v2/checkout/orders/ORD1": { status: 204 } });
    await expect(
      new PayPal(ENV, pp.fetch).patchOrder("ORD1", undefined, { ...NEW_AMOUNT, total: "1.00" }, NEW_ITEMS),
    ).rejects.toThrow(RangeError);
    expect(pp.calls()).toHaveLength(0);
  });
});

const AUTHORIZED_ORDER = {
  id: "ORD1",
  intent: "AUTHORIZE",
  status: "COMPLETED",
  payer: { payer_id: "BUYERPAYER01", email_address: "buyer@example.com", name: { given_name: "A", surname: "B" } },
  purchase_units: [
    {
      reference_id: "default",
      custom_id: "CART-7F3K2Q9X",
      amount: { currency_code: "USD", value: "32.80" },
      payee: { merchant_id: MERCHANT, email_address: "seller@example.com" },
      payments: {
        authorizations: [
          {
            id: "AUTH1",
            status: "CREATED",
            amount: { currency_code: "USD", value: "32.80" },
            expiration_time: "2026-12-08T10:00:00Z",
          },
        ],
      },
    },
  ],
  links: [{ href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD1", rel: "self", method: "GET" }],
};

describe("getOrder", () => {
  it("summarises status, payer, custom id and the authorization", async () => {
    const pp = fakePayPal({ "GET /v2/checkout/orders/ORD1": { json: AUTHORIZED_ORDER } });
    const view = await new PayPal(ENV, pp.fetch).getOrder("ORD1", MERCHANT);

    expect(view).toEqual({
      id: "ORD1",
      status: "COMPLETED",
      intent: "AUTHORIZE",
      customId: "CART-7F3K2Q9X",
      payerId: "BUYERPAYER01",
      payerEmail: "buyer@example.com",
      amount: { currency: "USD", value: "32.80" },
      payeeMerchantId: MERCHANT,
      authorizationId: "AUTH1",
      authorizationStatus: "CREATED",
    });
    const req = pp.last();
    expect(req.method).toBe("GET");
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("keeps the approval link of an order still waiting for the buyer", async () => {
    const pp = fakePayPal({
      "GET /v2/checkout/orders/ORD2": {
        json: {
          id: "ORD2",
          intent: "AUTHORIZE",
          status: "PAYER_ACTION_REQUIRED",
          purchase_units: [{ reference_id: "default", amount: { currency_code: "USD", value: "5.00" } }],
          links: [{ href: "https://www.sandbox.paypal.com/checkoutnow?token=ORD2", rel: "payer-action", method: "GET" }],
        },
      },
    });
    const view = await new PayPal(ENV, pp.fetch).getOrder("ORD2");
    expect(view.status).toBe("PAYER_ACTION_REQUIRED");
    expect(view.approveUrl).toBe("https://www.sandbox.paypal.com/checkoutnow?token=ORD2");
    expect(view.payerId).toBeUndefined();
    expect(pp.last().headers.has("paypal-auth-assertion")).toBe(false);
  });

  it("reports captures on the order", async () => {
    const captured = structuredClone(AUTHORIZED_ORDER) as any;
    captured.purchase_units[0].payments.captures = [{ id: "CAP1", status: "COMPLETED" }];
    const pp = fakePayPal({ "GET /v2/checkout/orders/ORD1": { json: captured } });
    const view = await new PayPal(ENV, pp.fetch).getOrder("ORD1");
    expect(view.captureId).toBe("CAP1");
    expect(view.captureStatus).toBe("COMPLETED");
  });
});

describe("authorizeOrder", () => {
  it("authorizes an approved order idempotently and returns the authorization and payer", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders/ORD1/authorize": { status: 201, json: AUTHORIZED_ORDER } });
    const out = await new PayPal(ENV, pp.fetch).authorizeOrder("ORD1", MERCHANT, "CART-7F3K2Q9X-checkout");

    expect(out).toEqual({
      authorizationId: "AUTH1",
      payerId: "BUYERPAYER01",
      status: "COMPLETED",
      authorizationStatus: "CREATED",
    });
    const req = pp.last();
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD1/authorize");
    expect(req.json()).toEqual({});
    expect(req.headers.get("paypal-request-id")).toBe("CART-7F3K2Q9X-checkout");
    expect(req.headers.get("prefer")).toBe("return=representation");
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("sends no platform headers for first-party calls", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders/ORD1/authorize": { status: 201, json: AUTHORIZED_ORDER } });
    await new PayPal(ENV, pp.fetch).authorizeOrder("ORD1", undefined, "req-1");
    expect(pp.last().headers.has("paypal-auth-assertion")).toBe(false);
    expect(pp.last().headers.has("paypal-partner-attribution-id")).toBe(false);
  });

  it("passes PayPal's refusal through with its issue", async () => {
    const pp = fakePayPal({
      "POST /v2/checkout/orders/ORD1/authorize": {
        status: 422,
        json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }], message: "not approved" },
      },
    });
    const err = await new PayPal(ENV, pp.fetch).authorizeOrder("ORD1", undefined, "r").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).has("ORDER_NOT_APPROVED")).toBe(true);
  });
});
