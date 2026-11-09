import { describe, it, expect } from "vitest";
import { PayPal, PayPalApiError } from "../src/index";
import { ENV, MERCHANT, expectedAssertion, fakePayPal } from "./fake";

const CAPTURED = {
  id: "CAP1",
  status: "COMPLETED",
  amount: { currency_code: "USD", value: "32.80" },
  final_capture: true,
  links: [],
};

describe("captureAuthorization", () => {
  it("captures the full authorization as the final capture", async () => {
    const pp = fakePayPal({ "POST /v2/payments/authorizations/AUTH1/capture": { status: 201, json: CAPTURED } });
    const out = await new PayPal(ENV, pp.fetch).captureAuthorization("AUTH1", undefined, {
      finalCapture: true,
      requestId: "ORDER-9-capture",
    });

    expect(out).toEqual({ captureId: "CAP1", status: "COMPLETED" });
    const req = pp.last();
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH1/capture");
    expect(req.json()).toEqual({ final_capture: true });
    expect(req.headers.get("paypal-request-id")).toBe("ORDER-9-capture");
    expect(req.headers.get("prefer")).toBe("return=representation");
    expect(req.headers.has("paypal-auth-assertion")).toBe(false);
    expect(req.headers.has("paypal-partner-attribution-id")).toBe(false);
  });

  it("takes the platform fee and an explicit amount when acting for a merchant", async () => {
    const pp = fakePayPal({ "POST /v2/payments/authorizations/AUTH1/capture": { status: 201, json: CAPTURED } });
    await new PayPal(ENV, pp.fetch).captureAuthorization("AUTH1", MERCHANT, {
      amount: { currency: "USD", value: "30.00" },
      finalCapture: true,
      platformFee: { currency: "USD", value: "0.90" },
      requestId: "ORDER-9-capture",
    });

    const req = pp.last();
    expect(req.json()).toEqual({
      amount: { currency_code: "USD", value: "30.00" },
      final_capture: true,
      payment_instruction: { platform_fees: [{ amount: { currency_code: "USD", value: "0.90" } }] },
    });
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("surfaces an expired authorization", async () => {
    const pp = fakePayPal({
      "POST /v2/payments/authorizations/AUTH1/capture": {
        status: 422,
        json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AUTHORIZATION_EXPIRED" }], message: "expired" },
      },
    });
    const err = await new PayPal(ENV, pp.fetch)
      .captureAuthorization("AUTH1", undefined, { finalCapture: true, requestId: "r" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).issue).toBe("AUTHORIZATION_EXPIRED");
  });
});

describe("voidAuthorization", () => {
  it("voids the authorization for the merchant", async () => {
    const pp = fakePayPal({ "POST /v2/payments/authorizations/AUTH1/void": { status: 204 } });
    await new PayPal(ENV, pp.fetch).voidAuthorization("AUTH1", MERCHANT, "ORDER-9-void");

    const req = pp.last();
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH1/void");
    expect(req.text).toBe("");
    expect(req.headers.get("paypal-request-id")).toBe("ORDER-9-void");
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("works first-party without a request id", async () => {
    const pp = fakePayPal({ "POST /v2/payments/authorizations/AUTH1/void": { status: 204 } });
    await expect(new PayPal(ENV, pp.fetch).voidAuthorization("AUTH1")).resolves.toBeUndefined();
    expect(pp.last().headers.has("paypal-auth-assertion")).toBe(false);
    expect(pp.last().headers.has("paypal-request-id")).toBe(false);
  });

  it("throws when PayPal refuses", async () => {
    const pp = fakePayPal({
      "POST /v2/payments/authorizations/AUTH1/void": {
        status: 422,
        json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "PREVIOUSLY_CAPTURED" }], message: "captured" },
      },
    });
    await expect(new PayPal(ENV, pp.fetch).voidAuthorization("AUTH1")).rejects.toBeInstanceOf(PayPalApiError);
  });
});

describe("refundCapture", () => {
  it("refunds the whole capture with an empty body", async () => {
    const pp = fakePayPal({
      "POST /v2/payments/captures/CAP1/refund": { status: 201, json: { id: "REF1", status: "COMPLETED" } },
    });
    const out = await new PayPal(ENV, pp.fetch).refundCapture("CAP1", MERCHANT, { requestId: "CAP1-refund-1" });

    expect(out).toEqual({ refundId: "REF1", status: "COMPLETED" });
    const req = pp.last();
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v2/payments/captures/CAP1/refund");
    expect(req.json()).toEqual({});
    expect(req.headers.get("paypal-request-id")).toBe("CAP1-refund-1");
    expect(req.headers.get("prefer")).toBe("return=representation");
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("refunds part of the capture", async () => {
    const pp = fakePayPal({
      "POST /v2/payments/captures/CAP1/refund": { status: 201, json: { id: "REF2", status: "PENDING" } },
    });
    const out = await new PayPal(ENV, pp.fetch).refundCapture("CAP1", undefined, {
      amount: { currency: "USD", value: "10.99" },
      requestId: "CAP1-refund-2",
    });
    expect(out).toEqual({ refundId: "REF2", status: "PENDING" });
    expect(pp.last().json()).toEqual({ amount: { currency_code: "USD", value: "10.99" } });
    expect(pp.last().headers.has("paypal-auth-assertion")).toBe(false);
  });

  it("rejects a malformed amount before calling PayPal", async () => {
    const pp = fakePayPal();
    await expect(
      new PayPal(ENV, pp.fetch).refundCapture("CAP1", undefined, {
        amount: { currency: "USD", value: "10.999" },
        requestId: "r",
      }),
    ).rejects.toThrow(RangeError);
    expect(pp.calls()).toHaveLength(0);
  });
});
