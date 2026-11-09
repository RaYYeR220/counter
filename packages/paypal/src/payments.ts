import type { CaptureRequest, RefundRequest } from "@paypal/paypal-server-sdk";
import type { Money } from "./env";
import { toCents } from "./money";
import type { Transport } from "./transport";

export interface CaptureParams {
  /** Defaults to the full authorized amount. */
  amount?: Money;
  /** Always final: one capture per authorization releases the rest of the hold. */
  finalCapture: true;
  /** Platform fee taken from the merchant's proceeds (needs the PARTNER_FEE permission). */
  platformFee?: Money;
  requestId: string;
}

function sdkMoney(m: Money) {
  toCents(m.value, "amount");
  return { currencyCode: m.currency, value: m.value };
}

/** Captures an authorization, typically when the order ships. */
export async function captureAuthorization(
  t: Transport,
  authorizationId: string,
  merchantId: string | undefined,
  p: CaptureParams,
): Promise<{ captureId: string; status: string }> {
  const body: CaptureRequest = {
    ...(p.amount ? { amount: sdkMoney(p.amount) } : {}),
    finalCapture: p.finalCapture,
    ...(p.platformFee ? { paymentInstruction: { platformFees: [{ amount: sdkMoney(p.platformFee) }] } } : {}),
  };
  const { result } = await t.sdkCall(`POST /v2/payments/authorizations/${authorizationId}/capture`, () =>
    t.payments.captureAuthorizedPayment({
      authorizationId,
      body,
      paypalRequestId: p.requestId,
      prefer: "return=representation",
      paypalAuthAssertion: t.assertion(merchantId),
    }),
  );
  if (!result.id) throw new Error(`capture of authorization ${authorizationId} returned no capture id`);
  return { captureId: result.id, status: result.status ?? "UNKNOWN" };
}

/** Releases the hold on an authorization that will not be captured. */
export async function voidAuthorization(
  t: Transport,
  authorizationId: string,
  merchantId?: string,
  requestId?: string,
): Promise<void> {
  await t.sdkCall(`POST /v2/payments/authorizations/${authorizationId}/void`, () =>
    t.payments.voidPayment({
      authorizationId,
      paypalRequestId: requestId,
      paypalAuthAssertion: t.assertion(merchantId),
    }),
  );
}

/** Refunds a capture in full, or `amount` of it. */
export async function refundCapture(
  t: Transport,
  captureId: string,
  merchantId: string | undefined,
  p: { amount?: Money; requestId: string },
): Promise<{ refundId: string; status: string }> {
  const body: RefundRequest = p.amount ? { amount: sdkMoney(p.amount) } : {};
  const { result } = await t.sdkCall(`POST /v2/payments/captures/${captureId}/refund`, () =>
    t.payments.refundCapturedPayment({
      captureId,
      body,
      paypalRequestId: p.requestId,
      prefer: "return=representation",
      paypalAuthAssertion: t.assertion(merchantId),
    }),
  );
  if (!result.id) throw new Error(`refund of capture ${captureId} returned no refund id`);
  return { refundId: result.id, status: result.status ?? "UNKNOWN" };
}
