import { getShop, type Db } from "@counter/db";
import type { MerchantStatus } from "@counter/paypal";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ONBOARDING_FEATURES,
  PlatformError,
  completeOnboarding,
  onboardingStatusOf,
  slugFromTrackingId,
  startOnboarding,
  trackingIdFor,
} from "../src/index";
import { MERCHANT, eventsOf, fakePayPal, shopDb } from "./support";

const PARTNER = "/v1/customer/partners/PARTNERMID001/merchant-integrations";

function sellerStatus(over: Record<string, unknown> = {}) {
  return {
    merchant_id: MERCHANT,
    tracking_id: "counter-juniper-clay",
    payments_receivable: true,
    primary_email_confirmed: true,
    legal_name: "Juniper Clay LLC",
    country: "US",
    products: [{ name: "EXPRESS_CHECKOUT", status: "ACTIVE", vetting_status: "SUBSCRIBED" }],
    oauth_integrations: [{ oauth_third_party: [{ partner_client_id: "PLATFORM-CLIENT", scopes: ["https://uri.paypal.com/services/payments/refund"] }] }],
    ...over,
  };
}

function status(over: Partial<MerchantStatus> = {}): MerchantStatus {
  return { merchantId: MERCHANT, paymentsReceivable: true, primaryEmailConfirmed: true, products: [], scopes: [], ...over };
}

describe("tracking ids", () => {
  it("name the shop and read back", () => {
    expect(trackingIdFor("juniper-clay")).toBe("counter-juniper-clay");
    expect(slugFromTrackingId("counter-juniper-clay")).toBe("juniper-clay");
    expect(slugFromTrackingId("counter-")).toBeNull();
    expect(slugFromTrackingId("shop_juniper")).toBeNull();
  });
});

describe("startOnboarding", () => {
  it("creates a partner referral for the shop with the permissions Counter uses", async () => {
    const pp = fakePayPal({
      "POST /v2/customer/partner-referrals": {
        status: 201,
        json: {
          links: [
            { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/NDZl" },
            { rel: "action_url", href: "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=NDZl" },
          ],
        },
      },
    });
    const out = await startOnboarding(pp.client, {
      shopSlug: "juniper-clay",
      returnUrl: "https://counter.test/api/onboarding/return?shop=juniper-clay",
      email: "owner@juniperclay.example",
    });

    expect(out).toEqual({
      actionUrl: "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=NDZl",
      trackingId: "counter-juniper-clay",
    });
    const body = pp.calls()[0]!.json();
    expect(body).toMatchObject({
      tracking_id: "counter-juniper-clay",
      email: "owner@juniperclay.example",
      partner_config_override: { return_url: "https://counter.test/api/onboarding/return?shop=juniper-clay" },
    });
    const features = body.operations[0].api_integration_preference.rest_api_integration.third_party_details.features;
    expect(features).toEqual([...ONBOARDING_FEATURES]);
    for (const f of ["PAYMENT", "REFUND", "PARTNER_FEE", "READ_SELLER_DISPUTE", "UPDATE_SELLER_DISPUTE", "TRACKING_SHIPMENT_READWRITE"]) {
      expect(features).toContain(f);
    }
  });
});

describe("onboardingStatusOf", () => {
  it("is active only when the seller can take payments and has confirmed their email", () => {
    expect(onboardingStatusOf(status())).toBe("active");
    expect(onboardingStatusOf(status({ primaryEmailConfirmed: false }))).toBe("pending");
    expect(onboardingStatusOf(status({ paymentsReceivable: false }))).toBe("pending");
    expect(onboardingStatusOf(null)).toBe("pending");
  });
});

describe("completeOnboarding", () => {
  let db: Db;
  beforeEach(async () => {
    db = await shopDb();
  });

  it("finds the seller by the shop's tracking id and makes the shop active", async () => {
    const pp = fakePayPal({
      [`GET ${PARTNER}`]: { json: { merchant_id: MERCHANT, tracking_id: "counter-juniper-clay" } },
      [`GET ${PARTNER}/${MERCHANT}`]: { json: sellerStatus() },
    });
    const out = await completeOnboarding(db, pp.client, { shopSlug: "juniper-clay", merchantIdInPayPal: MERCHANT });

    expect(out).toMatchObject({ shopSlug: "juniper-clay", merchantId: MERCHANT, status: "active" });
    expect(pp.calls()[0]!.path).toBe(`${PARTNER}?tracking_id=counter-juniper-clay`);
    expect(await getShop(db, "juniper-clay")).toMatchObject({ paypalMerchantId: MERCHANT, onboardingStatus: "active" });
    expect(await eventsOf(db, "shop.onboarding", "juniper-clay")).toHaveLength(1);
  });

  it("keeps the shop pending until the seller confirms their email", async () => {
    const pp = fakePayPal({
      [`GET ${PARTNER}`]: { json: { merchant_id: MERCHANT } },
      [`GET ${PARTNER}/${MERCHANT}`]: { json: sellerStatus({ primary_email_confirmed: false }) },
    });
    const out = await completeOnboarding(db, pp.client, { shopSlug: "juniper-clay" });
    expect(out.status).toBe("pending");
    expect(await getShop(db, "juniper-clay")).toMatchObject({ paypalMerchantId: MERCHANT, onboardingStatus: "pending" });
  });

  it("falls back to the merchant id on the return URL when the tracking id is not indexed yet", async () => {
    const pp = fakePayPal({
      [`GET ${PARTNER}`]: { status: 404, json: { name: "RESOURCE_NOT_FOUND" } },
      [`GET ${PARTNER}/${MERCHANT}`]: { json: sellerStatus() },
    });
    const out = await completeOnboarding(db, pp.client, { shopSlug: "juniper-clay", merchantIdInPayPal: MERCHANT });
    expect(out).toMatchObject({ merchantId: MERCHANT, status: "active" });
  });

  it("refuses a merchant id that PayPal ties to another shop's signup", async () => {
    const pp = fakePayPal({
      [`GET ${PARTNER}`]: { status: 404, json: { name: "RESOURCE_NOT_FOUND" } },
      [`GET ${PARTNER}/${MERCHANT}`]: { json: sellerStatus({ tracking_id: "counter-northpaw-roasters" }) },
    });
    const err = await completeOnboarding(db, pp.client, { shopSlug: "juniper-clay", merchantIdInPayPal: MERCHANT }).catch((e: unknown) => e);
    expect((err as PlatformError).code).toBe("conflict");
    expect((await getShop(db, "juniper-clay"))!.paypalMerchantId).toBeNull();
  });

  it("refuses a return URL whose merchant id differs from the seller PayPal has for the shop", async () => {
    const pp = fakePayPal({
      [`GET ${PARTNER}`]: { json: { merchant_id: MERCHANT } },
      [`GET ${PARTNER}/${MERCHANT}`]: { json: sellerStatus() },
    });
    const err = await completeOnboarding(db, pp.client, { shopSlug: "juniper-clay", merchantIdInPayPal: "OTHERMID00001" }).catch((e: unknown) => e);
    expect((err as PlatformError).code).toBe("conflict");
  });

  it("marks the shop pending when PayPal has no seller for it yet", async () => {
    const pp = fakePayPal({ [`GET ${PARTNER}`]: { status: 404, json: { name: "RESOURCE_NOT_FOUND" } } });
    const out = await completeOnboarding(db, pp.client, { shopSlug: "juniper-clay" });
    expect(out).toMatchObject({ merchantId: null, status: "pending" });
    expect(await getShop(db, "juniper-clay")).toMatchObject({ paypalMerchantId: null, onboardingStatus: "pending" });
  });

  it("answers not_found for an unknown shop", async () => {
    const err = await completeOnboarding(db, fakePayPal().client, { shopSlug: "nope" }).catch((e: unknown) => e);
    expect((err as PlatformError).code).toBe("not_found");
  });
});
