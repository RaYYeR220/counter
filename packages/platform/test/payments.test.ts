import { describe, expect, it } from "vitest";
import { PayPal, PayPalApiError } from "@counter/paypal";
import type { ComputedCartForPayment } from "@counter/store-sync";
import { PayPalPayments } from "../src/payments";

const cart: ComputedCartForPayment = {
  cartId: "CART-AB12CD34EF",
  currency: "USD",
  items: [
    { variantId: "JC-MUG-SPECKLE-SAGE-12", parentId: "JC-MUG-SPECKLE", name: "Speckled mug · sage · 12 oz", url: "https://x/p", quantity: 2, unitCents: 3000 },
  ],
  subtotalCents: 6000,
  discountCents: 500,
  shippingCents: 599,
  taxCents: 0,
  totalCents: 6099,
  shippingAddress: { address_line_1: "1 Main St", admin_area_2: "Portland", admin_area_1: "OR", postal_code: "97205", country_code: "US" },
  recipientName: "Ada Buyer",
};

interface Call { method: string; path: string; body: unknown; headers: Record<string, string> }

function stubPayPal(responder: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    if (url.pathname === "/v1/oauth2/token") {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "Bearer" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const text = await req.text();
    const body = text.length ? JSON.parse(text) : null;
    const call = { method: req.method, path: url.pathname, body, headers };
    calls.push(call);
    const r = responder(call);
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new PayPal({ clientId: "CID", clientSecret: "SEC", base: "https://api-m.sandbox.paypal.com" }, fetchImpl);
  return { client, calls };
}

const shops = {
  merchantIdFor: async (shop: string) => (shop === "juniper-clay" ? "MERCHANT123" : undefined),
  brandFor: async () => "Juniper Clay",
};
const urls = { returnUrl: (shop: string) => `https://counter.test/paypal/return?shop=${shop}`, cancelUrl: (shop: string) => `https://counter.test/paypal/cancel?shop=${shop}` };

describe("PayPalPayments", () => {
  it("creates an AUTHORIZE order that mirrors the cart, paid to the shop's merchant account", async () => {
    const { client, calls } = stubPayPal(() => ({
      status: 201,
      body: { id: "ORDER1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1" }] },
    }));
    const payments = new PayPalPayments(client, shops, urls);
    const out = await payments.createOrder("juniper-clay", cart, "CART-AB12CD34EF-create");
    expect(out).toEqual({ orderId: "ORDER1", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1" });
    const body = calls[0]!.body as any;
    expect(body.intent).toBe("AUTHORIZE");
    const pu = body.purchase_units[0];
    expect(pu.custom_id).toBe("CART-AB12CD34EF");
    expect(pu.payee).toEqual({ merchant_id: "MERCHANT123" });
    expect(pu.amount.value).toBe("60.99");
    expect(pu.amount.breakdown.item_total.value).toBe("60.00");
    expect(pu.amount.breakdown.discount.value).toBe("5.00");
    expect(pu.amount.breakdown.shipping.value).toBe("5.99");
    expect(pu.items[0]).toMatchObject({ sku: "JC-MUG-SPECKLE-SAGE-12", quantity: "2", unit_amount: { value: "30.00" } });
    expect(pu.shipping.address).toMatchObject({ address_line_1: "1 Main St", admin_area_1: "OR", postal_code: "97205", country_code: "US" });
    expect(calls[0]!.headers["paypal-request-id"]).toBe("CART-AB12CD34EF-create");
  });

  it("omits payee and assertion for a shop that is not onboarded as a separate merchant", async () => {
    const { client, calls } = stubPayPal(() => ({ status: 201, body: { id: "ORDER2", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER2" }] } }));
    const payments = new PayPalPayments(client, shops, urls);
    await payments.createOrder("northpaw-roasters", cart, "r1");
    expect((calls[0]!.body as any).purchase_units[0].payee).toBeUndefined();
    expect(calls[0]!.headers["paypal-auth-assertion"]).toBeUndefined();
  });

  it("maps a declined authorization to DECLINED instead of throwing", async () => {
    const { client } = stubPayPal(() => ({
      status: 422,
      body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED", description: "declined" }], debug_id: "d1" },
    }));
    const payments = new PayPalPayments(client, shops, urls);
    const out = await payments.authorizeOrder("juniper-clay", "ORDER1", "CART-AB12CD34EF-authorize");
    expect(out).toEqual({ status: "DECLINED", reason: "INSTRUMENT_DECLINED" });
  });

  it("treats an order the buyer has not approved yet as declined, so the cart stays open", async () => {
    const { client } = stubPayPal(() => ({
      status: 422,
      body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }], debug_id: "d2" },
    }));
    const out = await new PayPalPayments(client, shops, urls).authorizeOrder("juniper-clay", "ORDER1", "x");
    expect(out).toEqual({ status: "DECLINED", reason: "ORDER_NOT_APPROVED" });
  });

  it("rethrows infrastructure failures so the merchant API answers 500", async () => {
    const { client } = stubPayPal(() => ({ status: 503, body: { name: "SERVICE_UNAVAILABLE", debug_id: "d3" } }));
    await expect(new PayPalPayments(client, shops, urls).authorizeOrder("juniper-clay", "ORDER1", "x")).rejects.toBeInstanceOf(PayPalApiError);
  });

  it("returns the authorization id and payer id on success", async () => {
    const { client } = stubPayPal(() => ({
      status: 201,
      body: {
        id: "ORDER1",
        status: "COMPLETED",
        payer: { payer_id: "PAYER9" },
        purchase_units: [{ payments: { authorizations: [{ id: "AUTH7", status: "CREATED" }] } }],
      },
    }));
    const out = await new PayPalPayments(client, shops, urls).authorizeOrder("juniper-clay", "ORDER1", "x");
    expect(out).toEqual({ status: "COMPLETED", authorizationId: "AUTH7", payerId: "PAYER9" });
  });

  it("patches amount and items and reports expired orders", async () => {
    const { client, calls } = stubPayPal((c) => (c.method === "PATCH" ? { status: 404, body: { name: "RESOURCE_NOT_FOUND", debug_id: "d4" } } : { status: 200, body: {} }));
    const out = await new PayPalPayments(client, shops, urls).patchOrder("juniper-clay", "ORDER1", cart);
    expect(out).toBe("expired");
    expect(calls[0]!.method).toBe("PATCH");
  });
});
