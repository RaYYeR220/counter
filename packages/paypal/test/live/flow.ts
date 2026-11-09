/**
 * Sandbox end-to-end flow against real PayPal. Needs PAYPAL_CLIENT_ID and
 * PAYPAL_CLIENT_SECRET; PAYPAL_MERCHANT_ID makes every call act for that
 * onboarded seller (payee + auth assertion), PAYPAL_BN_CODE and
 * PAYPAL_PARTNER_MERCHANT_ID fill in the platform details.
 *
 * Usage from a browser-automation step:
 *   const flow = await liveFlow();
 *   // approve flow.toCapture.approveUrl and flow.toVoid.approveUrl as a sandbox buyer
 *   const result = await flow.complete();
 */
import { PayPal, SANDBOX_BASE, type Breakdown, type Money, type OrderItem, type PayPalEnv } from "../../src/index";

export const LIVE = process.env.PAYPAL_LIVE === "1";

export function liveEnv(): PayPalEnv {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");
  return {
    clientId,
    clientSecret,
    base: SANDBOX_BASE,
    bnCode: process.env.PAYPAL_BN_CODE || undefined,
    partnerMerchantId: process.env.PAYPAL_PARTNER_MERCHANT_ID || undefined,
  };
}

export function liveMerchantId(): string | undefined {
  return process.env.PAYPAL_MERCHANT_ID || undefined;
}

export function sampleCart(): { amount: Breakdown; items: OrderItem[] } {
  return {
    amount: { currency: "USD", total: "32.80", itemTotal: "25.00", shipping: "5.99", taxTotal: "1.81" },
    items: [{ name: "Speckled Mug", quantity: 1, unitAmount: "25.00", sku: "MUG-SPK", category: "PHYSICAL_GOODS" }],
  };
}

export const SAMPLE_SHIPPING = {
  fullName: "Sandbox Buyer",
  address: { line1: "1 Main St", city: "San Jose", state: "CA", postalCode: "95131", countryCode: "US" },
};

export interface PendingOrder {
  orderId: string;
  approveUrl: string;
  customId: string;
}

export interface LiveFlowResult {
  captured: { orderId: string; authorizationId: string; captureId: string; captureStatus: string; payerId: string };
  voided: { orderId: string; authorizationId: string };
}

export interface LiveFlow {
  client: PayPal;
  merchantId?: string;
  /** Approve, then authorize and capture. */
  toCapture: PendingOrder;
  /** Approve, then authorize and void. */
  toVoid: PendingOrder;
  /** Run once both orders are approved by a sandbox buyer. */
  complete(): Promise<LiveFlowResult>;
}

export async function liveFlow(
  opts: { runId?: string; returnUrl?: string; cancelUrl?: string; platformFee?: Money } = {},
): Promise<LiveFlow> {
  const client = new PayPal(liveEnv());
  const merchantId = liveMerchantId();
  const runId = opts.runId ?? `LIVE${Date.now().toString(36).toUpperCase()}`;
  const returnUrl = opts.returnUrl ?? "https://example.com/paypal/return";
  const cancelUrl = opts.cancelUrl ?? "https://example.com/paypal/cancel";

  const open = async (suffix: string): Promise<PendingOrder> => {
    const customId = `CART-${runId}-${suffix}`;
    const { id, approveUrl } = await client.createAuthorizeOrder({
      merchantId,
      customId,
      ...sampleCart(),
      shipping: SAMPLE_SHIPPING,
      returnUrl,
      cancelUrl,
      requestId: `${customId}-create`,
    });
    return { orderId: id, approveUrl, customId };
  };

  const toCapture = await open("C");
  const toVoid = await open("V");

  return {
    client,
    merchantId,
    toCapture,
    toVoid,
    async complete() {
      const a = await client.authorizeOrder(toCapture.orderId, merchantId, `${toCapture.customId}-authorize`);
      const cap = await client.captureAuthorization(a.authorizationId, merchantId, {
        finalCapture: true,
        platformFee: merchantId ? opts.platformFee : undefined,
        requestId: `${toCapture.customId}-capture`,
      });
      const b = await client.authorizeOrder(toVoid.orderId, merchantId, `${toVoid.customId}-authorize`);
      await client.voidAuthorization(b.authorizationId, merchantId, `${toVoid.customId}-void`);
      return {
        captured: {
          orderId: toCapture.orderId,
          authorizationId: a.authorizationId,
          captureId: cap.captureId,
          captureStatus: cap.status,
          payerId: a.payerId,
        },
        voided: { orderId: toVoid.orderId, authorizationId: b.authorizationId },
      };
    },
  };
}
