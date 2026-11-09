import { describe, it, expect } from "vitest";
import { PayPal } from "../src/index";
import { ENV, fakePayPal } from "./fake";

const HEADERS = {
  "PAYPAL-AUTH-ALGO": "SHA256withRSA",
  "PAYPAL-CERT-URL": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
  "PAYPAL-TRANSMISSION-ID": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "PAYPAL-TRANSMISSION-SIG": "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==",
  "PAYPAL-TRANSMISSION-TIME": "2026-11-09T09:00:00Z",
  "Content-Type": "application/json",
};

// Formatting PayPal sent must survive untouched: "1.10" and the \u escape would not round-trip JSON.parse/stringify.
const RAW = '{"id":"WH-1","event_type":"CUSTOMER.DISPUTE.CREATED","resource":{"amount":1.10,"note":"caf\\u00e9"}}';

describe("verifyWebhook", () => {
  it("asks PayPal to verify the signature over the exact event bytes", async () => {
    const pp = fakePayPal({
      "POST /v1/notifications/verify-webhook-signature": { json: { verification_status: "SUCCESS" } },
    });
    const ok = await new PayPal(ENV, pp.fetch).verifyWebhook(HEADERS, RAW, "8PT597110X687430LKGECATA");

    expect(ok).toBe(true);
    const req = pp.last();
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    expect(req.contentType).toBe("application/json");
    expect(req.json()).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: HEADERS["PAYPAL-CERT-URL"],
      transmission_id: "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
      transmission_sig: HEADERS["PAYPAL-TRANSMISSION-SIG"],
      transmission_time: "2026-11-09T09:00:00Z",
      webhook_id: "8PT597110X687430LKGECATA",
      webhook_event: JSON.parse(RAW),
    });
    expect(req.text.endsWith(`"webhook_event":${RAW}}`)).toBe(true);
    expect(req.headers.has("paypal-auth-assertion")).toBe(false);
  });

  it("reads the transmission headers case-insensitively", async () => {
    const pp = fakePayPal({
      "POST /v1/notifications/verify-webhook-signature": { json: { verification_status: "SUCCESS" } },
    });
    const lower = Object.fromEntries(Object.entries(HEADERS).map(([k, v]) => [k.toLowerCase(), v]));
    expect(await new PayPal(ENV, pp.fetch).verifyWebhook(lower, RAW, "WH")).toBe(true);
    expect(pp.last().json().transmission_id).toBe("69cd13f0-d67a-11e5-baa3-778b53f4ae55");
  });

  it("returns false when PayPal says FAILURE", async () => {
    const pp = fakePayPal({
      "POST /v1/notifications/verify-webhook-signature": { json: { verification_status: "FAILURE" } },
    });
    expect(await new PayPal(ENV, pp.fetch).verifyWebhook(HEADERS, RAW, "WH")).toBe(false);
  });

  it("returns false without calling PayPal when a transmission header is missing", async () => {
    const pp = fakePayPal();
    const { "PAYPAL-TRANSMISSION-SIG": _, ...partial } = HEADERS;
    expect(await new PayPal(ENV, pp.fetch).verifyWebhook(partial, RAW, "WH")).toBe(false);
    expect(pp.calls()).toHaveLength(0);
  });

  it("returns false without calling PayPal when the body is not JSON", async () => {
    const pp = fakePayPal();
    expect(await new PayPal(ENV, pp.fetch).verifyWebhook(HEADERS, "not json", "WH")).toBe(false);
    expect(pp.calls()).toHaveLength(0);
  });
});
