import { describe, it, expect } from "vitest";
import { PayPal, PayPalApiError } from "../src/index";
import { ENV, MERCHANT, expectedAssertion, fakePayPal } from "./fake";

const ORDER = { id: "ORD1", status: "COMPLETED" };

describe("addTracking", () => {
  it("attaches the tracking number to the order's capture", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders/ORD1/track": { status: 201, json: ORDER } });
    await new PayPal(ENV, pp.fetch).addTracking("ORD1", MERCHANT, {
      captureId: "CAP1",
      trackingNumber: "9400111899223197428490",
      carrier: "USPS",
      items: [{ name: "Speckled Mug", quantity: 2, unitAmount: "18.00", sku: "MUG-SPK" }],
    });

    const req = pp.last();
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD1/track");
    expect(req.json()).toEqual({
      capture_id: "CAP1",
      tracking_number: "9400111899223197428490",
      carrier: "USPS",
      items: [{ name: "Speckled Mug", quantity: "2", sku: "MUG-SPK" }],
    });
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("sends carriers PayPal does not list as OTHER with the name spelled out", async () => {
    const pp = fakePayPal({ "POST /v2/checkout/orders/ORD1/track": { status: 201, json: ORDER } });
    await new PayPal(ENV, pp.fetch).addTracking("ORD1", undefined, {
      captureId: "CAP1",
      trackingNumber: "LC-778",
      carrier: "Lantern Local Courier",
      notifyPayer: true,
    });
    expect(pp.last().json()).toEqual({
      capture_id: "CAP1",
      tracking_number: "LC-778",
      carrier: "OTHER",
      carrier_name_other: "Lantern Local Courier",
      notify_payer: true,
    });
    expect(pp.last().headers.has("paypal-auth-assertion")).toBe(false);
  });

  it("throws when the capture is not trackable", async () => {
    const pp = fakePayPal({
      "POST /v2/checkout/orders/ORD1/track": {
        status: 422,
        json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INVALID_CAPTURE_STATUS" }], message: "no" },
      },
    });
    const err = await new PayPal(ENV, pp.fetch)
      .addTracking("ORD1", undefined, { captureId: "CAP1", trackingNumber: "1", carrier: "UPS" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).issue).toBe("INVALID_CAPTURE_STATUS");
  });
});
