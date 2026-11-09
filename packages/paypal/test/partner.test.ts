import { describe, it, expect } from "vitest";
import { PayPal, PayPalApiError, DEFAULT_REFERRAL_FEATURES } from "../src/index";
import { ENV, MERCHANT, fakePayPal } from "./fake";

const REFERRAL_RESPONSE = {
  links: [
    {
      href: "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/NDZlMjQ1",
      rel: "self",
      method: "GET",
    },
    {
      href: "https://www.sandbox.paypal.com/partnerexp/appEntry?referralToken=ZGY2M2Nj",
      rel: "action_url",
      method: "GET",
    },
  ],
};

describe("createPartnerReferral", () => {
  it("asks for third-party API permissions on Express Checkout with data-sharing consent", async () => {
    const pp = fakePayPal({ "POST /v2/customer/partner-referrals": { status: 201, json: REFERRAL_RESPONSE } });
    const out = await new PayPal(ENV, pp.fetch).createPartnerReferral({
      trackingId: "shop_juniper",
      returnUrl: "https://counter.example/onboarding/return",
    });

    expect(out).toEqual({
      actionUrl: "https://www.sandbox.paypal.com/partnerexp/appEntry?referralToken=ZGY2M2Nj",
      selfUrl: "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/NDZlMjQ1",
    });
    const req = pp.last();
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v2/customer/partner-referrals");
    expect(req.headers.get("authorization")).toBe("Bearer A21-token");
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
    expect(req.headers.has("paypal-auth-assertion")).toBe(false);
    expect(req.contentType).toBe("application/json");
    expect(req.json()).toEqual({
      tracking_id: "shop_juniper",
      partner_config_override: { return_url: "https://counter.example/onboarding/return" },
      operations: [
        {
          operation: "API_INTEGRATION",
          api_integration_preference: {
            rest_api_integration: {
              integration_method: "PAYPAL",
              integration_type: "THIRD_PARTY",
              third_party_details: {
                features: [
                  "PAYMENT",
                  "REFUND",
                  "PARTNER_FEE",
                  "DELAY_FUNDS_DISBURSEMENT",
                  "ACCESS_MERCHANT_INFORMATION",
                  "READ_SELLER_DISPUTE",
                  "UPDATE_SELLER_DISPUTE",
                  "ADVANCED_TRANSACTIONS_SEARCH",
                ],
              },
            },
          },
        },
      ],
      products: ["EXPRESS_CHECKOUT"],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
    });
    expect(DEFAULT_REFERRAL_FEATURES).toEqual(
      req.json().operations[0].api_integration_preference.rest_api_integration.third_party_details.features,
    );
  });

  it("prefills the seller email when known", async () => {
    const pp = fakePayPal({ "POST /v2/customer/partner-referrals": { status: 201, json: REFERRAL_RESPONSE } });
    await new PayPal(ENV, pp.fetch).createPartnerReferral({
      trackingId: "shop_juniper",
      returnUrl: "https://counter.example/r",
      email: "owner@juniperclay.example",
    });
    expect(pp.last().json().email).toBe("owner@juniperclay.example");
  });

  it("adds the vault permissions, product and capability for saved PayPal wallets", async () => {
    const pp = fakePayPal({ "POST /v2/customer/partner-referrals": { status: 201, json: REFERRAL_RESPONSE } });
    await new PayPal(ENV, pp.fetch).createPartnerReferral({
      trackingId: "shop_juniper",
      returnUrl: "https://counter.example/r",
      vaulting: true,
    });
    const body = pp.last().json();
    const features = body.operations[0].api_integration_preference.rest_api_integration.third_party_details.features;
    expect(features).toEqual([...DEFAULT_REFERRAL_FEATURES, "VAULT", "BILLING_AGREEMENT"]);
    expect(body.products).toEqual(["EXPRESS_CHECKOUT", "ADVANCED_VAULTING"]);
    expect(body.capabilities).toEqual(["PAYPAL_WALLET_VAULTING_ADVANCED"]);
  });

  it("lets the caller narrow the permission list to what the app has enabled", async () => {
    const pp = fakePayPal({ "POST /v2/customer/partner-referrals": { status: 201, json: REFERRAL_RESPONSE } });
    await new PayPal(ENV, pp.fetch).createPartnerReferral({
      trackingId: "t",
      returnUrl: "https://counter.example/r",
      features: ["PAYMENT", "REFUND"],
    });
    expect(
      pp.last().json().operations[0].api_integration_preference.rest_api_integration.third_party_details.features,
    ).toEqual(["PAYMENT", "REFUND"]);
  });

  it("fails when PayPal returns no action_url", async () => {
    const pp = fakePayPal({ "POST /v2/customer/partner-referrals": { status: 201, json: { links: [] } } });
    await expect(
      new PayPal(ENV, pp.fetch).createPartnerReferral({ trackingId: "t", returnUrl: "https://counter.example/r" }),
    ).rejects.toThrow(/action_url/);
  });
});

const STATUS = {
  merchant_id: MERCHANT,
  tracking_id: "shop_juniper",
  products: [{ name: "EXPRESS_CHECKOUT", status: "ACTIVE" }],
  payments_receivable: true,
  legal_name: "Juniper Clay LLC",
  primary_email: "owner@juniperclay.example",
  primary_email_confirmed: true,
  oauth_integrations: [
    {
      integration_type: "OAUTH_THIRD_PARTY",
      integration_method: "PAYPAL",
      oauth_third_party: [
        {
          partner_client_id: "PLATFORM-CLIENT",
          merchant_client_id: "SELLER-CLIENT",
          scopes: [
            "https://uri.paypal.com/services/payments/realtimepayment",
            "https://uri.paypal.com/services/payments/refund",
          ],
        },
      ],
    },
  ],
  primary_currency: "USD",
  country: "US",
};

describe("merchantIntegration", () => {
  it("resolves a tracking id to the seller and reads its onboarding status", async () => {
    const pp = fakePayPal({
      "GET /v1/customer/partners/PARTNERMID001/merchant-integrations": {
        json: { merchant_id: MERCHANT, tracking_id: "shop_juniper", links: [] },
      },
      [`GET /v1/customer/partners/PARTNERMID001/merchant-integrations/${MERCHANT}`]: { json: STATUS },
    });
    const out = await new PayPal(ENV, pp.fetch).merchantIntegration({ trackingId: "shop_juniper" });

    expect(out).toEqual({
      merchantId: MERCHANT,
      trackingId: "shop_juniper",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
      legalName: "Juniper Clay LLC",
      country: "US",
      products: [{ name: "EXPRESS_CHECKOUT", status: "ACTIVE" }],
      scopes: [
        "https://uri.paypal.com/services/payments/realtimepayment",
        "https://uri.paypal.com/services/payments/refund",
      ],
    });
    const [lookup, status] = pp.calls();
    expect(lookup!.path).toBe("/v1/customer/partners/PARTNERMID001/merchant-integrations?tracking_id=shop_juniper");
    expect(status!.path).toBe(`/v1/customer/partners/PARTNERMID001/merchant-integrations/${MERCHANT}`);
    for (const c of pp.calls()) {
      expect(c.method).toBe("GET");
      expect(c.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
      expect(c.headers.has("paypal-auth-assertion")).toBe(false);
    }
  });

  it("goes straight to the status call for a merchant id", async () => {
    const pp = fakePayPal({
      [`GET /v1/customer/partners/PARTNERMID001/merchant-integrations/${MERCHANT}`]: { json: STATUS },
    });
    const out = await new PayPal(ENV, pp.fetch).merchantIntegration({ merchantId: MERCHANT });
    expect(out?.merchantId).toBe(MERCHANT);
    expect(pp.calls()).toHaveLength(1);
  });

  it("treats a bare 13-character PayPal id as a merchant id and anything else as a tracking id", async () => {
    const pp = fakePayPal({
      "GET /v1/customer/partners/PARTNERMID001/merchant-integrations": {
        json: { merchant_id: MERCHANT, tracking_id: "shop_juniper" },
      },
      [`GET /v1/customer/partners/PARTNERMID001/merchant-integrations/${MERCHANT}`]: { json: STATUS },
    });
    const client = new PayPal(ENV, pp.fetch);
    await client.merchantIntegration(MERCHANT);
    expect(pp.calls()).toHaveLength(1);
    await client.merchantIntegration("shop_juniper");
    expect(pp.calls()).toHaveLength(3);
    expect(pp.calls()[1]!.path).toContain("tracking_id=shop_juniper");
  });

  it("returns null while the seller has not finished signing up", async () => {
    const pp = fakePayPal({
      "GET /v1/customer/partners/PARTNERMID001/merchant-integrations": {
        status: 404,
        json: { name: "RESOURCE_NOT_FOUND", message: "not found" },
      },
    });
    expect(await new PayPal(ENV, pp.fetch).merchantIntegration({ trackingId: "shop_new" })).toBeNull();
  });

  it("reports a seller who has not granted permissions or confirmed email", async () => {
    const pp = fakePayPal({
      [`GET /v1/customer/partners/PARTNERMID001/merchant-integrations/${MERCHANT}`]: {
        json: { merchant_id: MERCHANT, payments_receivable: false, primary_email_confirmed: false },
      },
    });
    const out = await new PayPal(ENV, pp.fetch).merchantIntegration({ merchantId: MERCHANT });
    expect(out).toMatchObject({ paymentsReceivable: false, primaryEmailConfirmed: false, scopes: [], products: [] });
  });

  it("needs the platform's own merchant id", async () => {
    const pp = fakePayPal();
    const { partnerMerchantId: _, ...env } = ENV;
    await expect(new PayPal(env, pp.fetch).merchantIntegration({ merchantId: MERCHANT })).rejects.toThrow(
      /partnerMerchantId/,
    );
  });

  it("propagates other errors", async () => {
    const pp = fakePayPal({
      [`GET /v1/customer/partners/PARTNERMID001/merchant-integrations/${MERCHANT}`]: {
        status: 403,
        json: { name: "NOT_AUTHORIZED", message: "no" },
      },
    });
    await expect(new PayPal(ENV, pp.fetch).merchantIntegration({ merchantId: MERCHANT })).rejects.toBeInstanceOf(
      PayPalApiError,
    );
  });
});
