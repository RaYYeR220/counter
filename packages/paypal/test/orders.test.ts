import { describe, it, expect } from "vitest";
import { PayPal, PayPalApiError, type Breakdown, type OrderItem } from "../src/index";
import { ENV, MERCHANT, expectedAssertion, fakePayPal } from "./fake";

const AMOUNT: Breakdown = { currency: "USD", total: "32.80", itemTotal: "25.00", shipping: "5.99", taxTotal: "1.81" };
const ITEMS: OrderItem[] = [{ name: "Black Tee (M)", quantity: 1, unitAmount: "25.00", sku: "TEE-BLK-M" }];
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

const CREATED = {
  id: "5O190127TN364715T",
  status: "PAYER_ACTION_REQUIRED",
  links: [
    { href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T", rel: "self", method: "GET" },
    {
      href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T",
      rel: "payer-action",
      method: "GET",
    },
  ],
};

function create(pp: ReturnType<typeof fakePayPal>, merchantId?: string) {
  return new PayPal(ENV, pp.fetch).createAuthorizeOrder({
    merchantId,
    customId: "CART-7F3K2Q9X",
    amount: AMOUNT,
    items: ITEMS,
    shipping: SHIPPING,
    returnUrl: "https://counter.example/paypal/return",
    cancelUrl: "https://counter.example/paypal/cancel",
    requestId: "CART-7F3K2Q9X-create",
  });
}

describe("createAuthorizeOrder", () => {
  it("posts an AUTHORIZE order mirroring the cart totals", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { status: 200, json: CREATED } });
    const out = await create(pp);

    expect(out).toEqual({
      id: "5O190127TN364715T",
      approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T",
    });
    const req = pp.last();
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(req.json()).toEqual({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: "default",
          custom_id: "CART-7F3K2Q9X",
          amount: {
            currency_code: "USD",
            value: "32.80",
            breakdown: {
              item_total: { currency_code: "USD", value: "25.00" },
              shipping: { currency_code: "USD", value: "5.99" },
              tax_total: { currency_code: "USD", value: "1.81" },
            },
          },
          items: [
            { name: "Black Tee (M)", quantity: "1", sku: "TEE-BLK-M", unit_amount: { currency_code: "USD", value: "25.00" } },
          ],
          shipping: {
            name: { full_name: "John Doe" },
            address: {
              address_line_1: "456 Fictional St",
              address_line_2: "Apt 4B",
              admin_area_2: "San Jose",
              admin_area_1: "CA",
              postal_code: "90210",
              country_code: "US",
            },
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: "SET_PROVIDED_ADDRESS",
            user_action: "PAY_NOW",
            return_url: "https://counter.example/paypal/return",
            cancel_url: "https://counter.example/paypal/cancel",
          },
        },
      },
    });
  });

  it("sends the bearer token, idempotency key and representation preference", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { json: CREATED } });
    await create(pp);
    const h = pp.last().headers;
    expect(h.get("authorization")).toBe("Bearer A21-token");
    expect(h.get("paypal-request-id")).toBe("CART-7F3K2Q9X-create");
    expect(h.get("prefer")).toBe("return=representation");
    expect(h.get("content-type")).toMatch(/^application\/json/);
  });

  it("goes through the PayPal Server SDK", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { json: CREATED } });
    await create(pp);
    expect(pp.last().headers.get("user-agent")).toMatch(/PayPal REST API TypeScript SDK/);
  });

  it("leaves out platform headers and payee when no merchant is given", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { json: CREATED } });
    await create(pp);
    const req = pp.last();
    expect(req.headers.has("paypal-auth-assertion")).toBe(false);
    expect(req.headers.has("paypal-partner-attribution-id")).toBe(false);
    expect(req.json().purchase_units[0].payee).toBeUndefined();
  });

  it("names the merchant as payee and acts on its behalf when merchantId is given", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { json: CREATED } });
    await create(pp, MERCHANT);
    const req = pp.last();
    expect(req.json().purchase_units[0].payee).toEqual({ merchant_id: MERCHANT });
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("reads the approval link when PayPal labels it approve", async () => {
    const pp = fakePayPal({
      "POST /v2/checkout/orders": {
        json: {
          id: "ORDER2",
          status: "CREATED",
          links: [
            { href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER2", rel: "approve", method: "GET" },
            { href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER2/capture", rel: "capture", method: "POST" },
          ],
        },
      },
    });
    const out = await create(pp);
    expect(out.approveUrl).toBe("https://www.sandbox.paypal.com/checkoutnow?token=ORDER2");
  });

  it("fails loudly when the response carries no approval link", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { json: { id: "X", status: "CREATED", links: [] } } });
    await expect(create(pp)).rejects.toThrow(/approv/i);
  });

  it("lets PayPal collect the address when the cart has none", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { json: CREATED } });
    await new PayPal(ENV, pp.fetch).createAuthorizeOrder({
      customId: "CART-1",
      amount: { currency: "USD", total: "25.00", itemTotal: "25.00" },
      items: ITEMS,
      returnUrl: "https://counter.example/r",
      cancelUrl: "https://counter.example/c",
      requestId: "CART-1-create",
    });
    const body = pp.last().json();
    expect(body.purchase_units[0].shipping).toBeUndefined();
    expect(body.payment_source.paypal.experience_context.shipping_preference).toBe("GET_FROM_FILE");
  });

  it("refuses a breakdown that does not add up to the total, without calling PayPal", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { json: CREATED } });
    await expect(
      new PayPal(ENV, pp.fetch).createAuthorizeOrder({
        customId: "CART-1",
        amount: { ...AMOUNT, total: "32.81" },
        items: ITEMS,
        returnUrl: "https://counter.example/r",
        cancelUrl: "https://counter.example/c",
        requestId: "r",
      }),
    ).rejects.toThrow(/total/);
    expect(pp.calls()).toHaveLength(0);
  });

  it("refuses items whose sum differs from item_total", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { json: CREATED } });
    await expect(
      new PayPal(ENV, pp.fetch).createAuthorizeOrder({
        customId: "CART-1",
        amount: AMOUNT,
        items: [{ name: "Tee", quantity: 2, unitAmount: "12.49" }],
        returnUrl: "https://counter.example/r",
        cancelUrl: "https://counter.example/c",
        requestId: "r",
      }),
    ).rejects.toThrow(/item_total/);
    expect(pp.calls()).toHaveLength(0);
  });

  it("subtracts discounts and adds handling and insurance when checking the total", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { json: CREATED } });
    await new PayPal(ENV, pp.fetch).createAuthorizeOrder({
      customId: "CART-2",
      amount: {
        currency: "USD",
        total: "47.00",
        itemTotal: "50.00",
        shipping: "5.00",
        handling: "1.50",
        insurance: "0.50",
        taxTotal: "2.00",
        shippingDiscount: "5.00",
        discount: "7.00",
      },
      items: [{ name: "Mug", quantity: 2, unitAmount: "25.00" }],
      returnUrl: "https://counter.example/r",
      cancelUrl: "https://counter.example/c",
      requestId: "r",
    });
    expect(pp.last().json().purchase_units[0].amount.breakdown).toEqual({
      item_total: { currency_code: "USD", value: "50.00" },
      shipping: { currency_code: "USD", value: "5.00" },
      handling: { currency_code: "USD", value: "1.50" },
      insurance: { currency_code: "USD", value: "0.50" },
      tax_total: { currency_code: "USD", value: "2.00" },
      shipping_discount: { currency_code: "USD", value: "5.00" },
      discount: { currency_code: "USD", value: "7.00" },
    });
  });

  it("surfaces PayPal validation errors as PayPalApiError with the issue", async () => {
    const pp = fakePayPal({
      "POST /v2/checkout/orders": {
        status: 422,
        json: {
          name: "UNPROCESSABLE_ENTITY",
          details: [{ issue: "PAYEE_NOT_CONSENTED", description: "Payee does not have appropriate consent" }],
          message: "The requested action could not be performed",
          debug_id: "dbg123",
        },
      },
    });
    const err = await create(pp, MERCHANT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err).toMatchObject({ status: 422, paypalName: "UNPROCESSABLE_ENTITY", issue: "PAYEE_NOT_CONSENTED", debugId: "dbg123" });
  });
});
