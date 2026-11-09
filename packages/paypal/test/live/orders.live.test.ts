import { describe, it, expect } from "vitest";
import { PayPal, TokenCache } from "../../src/index";
import { LIVE, SAMPLE_SHIPPING, liveEnv, liveMerchantId, sampleCart } from "./flow";

describe.skipIf(!LIVE)("PayPal sandbox", () => {
  it("issues an OAuth token for the app", async () => {
    const token = await new TokenCache(liveEnv(), fetch).get();
    expect(token.accessToken.length).toBeGreaterThan(20);
  });

  it("creates an AUTHORIZE order and hands back the buyer approval URL", async () => {
    const client = new PayPal(liveEnv());
    const merchantId = liveMerchantId();
    const runId = Date.now().toString(36).toUpperCase();
    const order = await client.createAuthorizeOrder({
      merchantId,
      customId: `CART-LIVE-${runId}`,
      ...sampleCart(),
      shipping: SAMPLE_SHIPPING,
      returnUrl: "https://example.com/paypal/return",
      cancelUrl: "https://example.com/paypal/cancel",
      requestId: `CART-LIVE-${runId}-create`,
    });
    console.log(`approve ${order.id}: ${order.approveUrl}`);
    expect(order.approveUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);

    const view = await client.getOrder(order.id, merchantId);
    expect(view.intent).toBe("AUTHORIZE");
    expect(view.customId).toBe(`CART-LIVE-${runId}`);
    if (merchantId) expect(view.payeeMerchantId).toBe(merchantId);

    const patched = await client.patchOrder(
      order.id,
      merchantId,
      { currency: "USD", total: "57.80", itemTotal: "50.00", shipping: "5.99", taxTotal: "1.81" },
      [{ name: "Speckled Mug", quantity: 2, unitAmount: "25.00", sku: "MUG-SPK", category: "PHYSICAL_GOODS" }],
    );
    expect(patched).toBe("ok");
    expect((await client.getOrder(order.id, merchantId)).amount).toEqual({ currency: "USD", value: "57.80" });
  });

  it("reports an unknown order as expired on PATCH", async () => {
    const client = new PayPal(liveEnv());
    const out = await client.patchOrder("0AA00000AA000000A", liveMerchantId(), sampleCart().amount, sampleCart().items);
    expect(out).toBe("expired");
  });
});
