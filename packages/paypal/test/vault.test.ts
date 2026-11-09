import { describe, it, expect } from "vitest";
import { PayPal, PayPalApiError } from "../src/index";
import { ENV, MERCHANT, expectedAssertion, fakePayPal } from "./fake";

const SETUP_TOKEN = {
  id: "4G4976650J0948357",
  customer: { id: "customer_4029352050", merchant_customer_id: "user_8f2c" },
  status: "PAYER_ACTION_REQUIRED",
  payment_source: { paypal: { usage_type: "MERCHANT", customer_type: "CONSUMER" } },
  links: [
    { href: "https://api-m.sandbox.paypal.com/v3/vault/setup-tokens/4G4976650J0948357", rel: "self", method: "GET" },
    {
      href: "https://sandbox.paypal.com/agreements/approve?approval_session_id=4G4976650J0948357",
      rel: "approve",
      method: "GET",
    },
  ],
};

describe("createVaultSetupToken", () => {
  it("starts a merchant-level PayPal wallet vault for the buyer to approve", async () => {
    const pp = fakePayPal({ "POST /v3/vault/setup-tokens": { status: 201, json: SETUP_TOKEN } });
    const out = await new PayPal(ENV, pp.fetch).createVaultSetupToken({
      merchantId: MERCHANT,
      merchantCustomerId: "user_8f2c",
      description: "Purchases your shopping agent makes at Juniper Clay",
      returnUrl: "https://counter.example/vault/return",
      cancelUrl: "https://counter.example/vault/cancel",
      requestId: "vault-user_8f2c-1",
    });

    expect(out).toEqual({
      setupTokenId: "4G4976650J0948357",
      status: "PAYER_ACTION_REQUIRED",
      approveUrl: "https://sandbox.paypal.com/agreements/approve?approval_session_id=4G4976650J0948357",
      customerId: "customer_4029352050",
    });
    const req = pp.last();
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v3/vault/setup-tokens");
    expect(req.json()).toEqual({
      customer: { merchant_customer_id: "user_8f2c" },
      payment_source: {
        paypal: {
          description: "Purchases your shopping agent makes at Juniper Clay",
          usage_pattern: "UNSCHEDULED_PREPAID",
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          experience_context: {
            return_url: "https://counter.example/vault/return",
            cancel_url: "https://counter.example/vault/cancel",
          },
        },
      },
    });
    expect(req.headers.get("paypal-request-id")).toBe("vault-user_8f2c-1");
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("links further tokens to an existing PayPal customer and takes a usage pattern", async () => {
    const pp = fakePayPal({ "POST /v3/vault/setup-tokens": { status: 201, json: SETUP_TOKEN } });
    await new PayPal(ENV, pp.fetch).createVaultSetupToken({
      customerId: "customer_4029352050",
      usagePattern: "DEFERRED",
      brandName: "Counter",
      returnUrl: "https://counter.example/r",
      cancelUrl: "https://counter.example/c",
      requestId: "r",
    });
    const body = pp.last().json();
    expect(body.customer).toEqual({ id: "customer_4029352050" });
    expect(body.payment_source.paypal.usage_pattern).toBe("DEFERRED");
    expect(body.payment_source.paypal.experience_context.brand_name).toBe("Counter");
    expect(pp.last().headers.has("paypal-auth-assertion")).toBe(false);
  });

  it("fails when PayPal sends no approval link", async () => {
    const pp = fakePayPal({
      "POST /v3/vault/setup-tokens": { status: 201, json: { id: "X", status: "PAYER_ACTION_REQUIRED", links: [] } },
    });
    await expect(
      new PayPal(ENV, pp.fetch).createVaultSetupToken({
        returnUrl: "https://counter.example/r",
        cancelUrl: "https://counter.example/c",
        requestId: "r",
      }),
    ).rejects.toThrow(/approv/i);
  });
});

describe("createPaymentToken", () => {
  it("exchanges the approved setup token for a vault id", async () => {
    const pp = fakePayPal({
      "POST /v3/vault/payment-tokens": {
        status: 201,
        json: {
          id: "jwgvx42",
          customer: { id: "customer_4029352050", merchant_customer_id: "user_8f2c" },
          payment_source: { paypal: { email_address: "buyer@example.com", payer_id: "AJM9JTWQJCFTA", usage_type: "MERCHANT" } },
          links: [],
        },
      },
    });
    const out = await new PayPal(ENV, pp.fetch).createPaymentToken({
      setupTokenId: "4G4976650J0948357",
      merchantId: MERCHANT,
      requestId: "vault-user_8f2c-1-token",
    });

    expect(out).toEqual({
      vaultId: "jwgvx42",
      customerId: "customer_4029352050",
      payerId: "AJM9JTWQJCFTA",
      payerEmail: "buyer@example.com",
    });
    const req = pp.last();
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v3/vault/payment-tokens");
    expect(req.json()).toEqual({ payment_source: { token: { id: "4G4976650J0948357", type: "SETUP_TOKEN" } } });
    expect(req.headers.get("paypal-request-id")).toBe("vault-user_8f2c-1-token");
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("surfaces a setup token the buyer has not approved", async () => {
    const pp = fakePayPal({
      "POST /v3/vault/payment-tokens": {
        status: 422,
        json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "SETUP_TOKEN_NOT_APPROVED" }], message: "no" },
      },
    });
    const err = await new PayPal(ENV, pp.fetch)
      .createPaymentToken({ setupTokenId: "X", requestId: "r" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).status).toBe(422);
  });
});

const VAULTED_ORDER = {
  id: "ORDV1",
  intent: "AUTHORIZE",
  status: "COMPLETED",
  payment_source: { paypal: { account_id: "AJM9JTWQJCFTA", email_address: "buyer@example.com" } },
  purchase_units: [
    {
      reference_id: "default",
      payments: { authorizations: [{ id: "AUTHV1", status: "CREATED" }] },
    },
  ],
  links: [],
};

describe("chargeVaulted", () => {
  it("authorizes a merchant-initiated charge against the saved wallet", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { status: 201, json: VAULTED_ORDER } });
    const out = await new PayPal(ENV, pp.fetch).chargeVaulted({
      vaultId: "jwgvx42",
      amount: { currency: "USD", total: "36.00", itemTotal: "36.00" },
      items: [{ name: "Speckled Mug", quantity: 2, unitAmount: "18.00", sku: "MUG-SPK" }],
      customId: "CART-AGENT01",
      requestId: "CART-AGENT01-charge",
      merchantId: MERCHANT,
    });

    expect(out).toEqual({
      orderId: "ORDV1",
      status: "COMPLETED",
      authorizationId: "AUTHV1",
      authorizationStatus: "CREATED",
      payerId: "AJM9JTWQJCFTA",
    });
    const req = pp.last();
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(req.json()).toEqual({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: "default",
          custom_id: "CART-AGENT01",
          amount: {
            currency_code: "USD",
            value: "36.00",
            breakdown: { item_total: { currency_code: "USD", value: "36.00" } },
          },
          items: [{ name: "Speckled Mug", quantity: "2", sku: "MUG-SPK", unit_amount: { currency_code: "USD", value: "18.00" } }],
          payee: { merchant_id: MERCHANT },
        },
      ],
      payment_source: {
        paypal: {
          vault_id: "jwgvx42",
          stored_credential: {
            payment_initiator: "MERCHANT",
            usage: "SUBSEQUENT",
            usage_pattern: "UNSCHEDULED_PREPAID",
          },
        },
      },
    });
    expect(req.headers.get("paypal-request-id")).toBe("CART-AGENT01-charge");
    expect(req.headers.get("prefer")).toBe("return=representation");
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("ships to the given address and checks the amount first", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders": { status: 201, json: VAULTED_ORDER } });
    const client = new PayPal(ENV, pp.fetch);
    await expect(
      client.chargeVaulted({
        vaultId: "v",
        amount: { currency: "USD", total: "40.00", itemTotal: "36.00" },
        items: [{ name: "Mug", quantity: 2, unitAmount: "18.00" }],
        customId: "c",
        requestId: "r",
      }),
    ).rejects.toThrow(RangeError);
    expect(pp.calls()).toHaveLength(0);

    await client.chargeVaulted({
      vaultId: "v",
      amount: { currency: "USD", total: "41.99", itemTotal: "36.00", shipping: "5.99" },
      items: [{ name: "Mug", quantity: 2, unitAmount: "18.00" }],
      shipping: { fullName: "Ada L", address: { line1: "1 Main St", city: "Portland", state: "OR", postalCode: "97201", countryCode: "US" } },
      customId: "c",
      requestId: "r",
    });
    const body = pp.last().json();
    expect(body.purchase_units[0].shipping.address.admin_area_2).toBe("Portland");
    expect(body.purchase_units[0].payee).toBeUndefined();
    expect(pp.last().headers.has("paypal-auth-assertion")).toBe(false);
  });

  it("fails when the charge yields no authorization", async () => {
    const pp = fakePayPal({
      "POST /v2/checkout/orders": { status: 201, json: { id: "ORDV2", status: "PAYER_ACTION_REQUIRED", links: [] } },
    });
    await expect(
      new PayPal(ENV, pp.fetch).chargeVaulted({
        vaultId: "v",
        amount: { currency: "USD", total: "18.00", itemTotal: "18.00" },
        items: [{ name: "Mug", quantity: 1, unitAmount: "18.00" }],
        customId: "c",
        requestId: "r",
      }),
    ).rejects.toThrow(/ORDV2.*PAYER_ACTION_REQUIRED/);
  });
});
