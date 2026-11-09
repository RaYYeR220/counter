import {
  CheckoutPaymentIntent,
  PaymentInitiator,
  StoredPaymentSourceUsageType,
  UsagePattern,
  type OrderRequest,
} from "@paypal/paypal-server-sdk";
import type { Breakdown, OrderItem, OrderShipping } from "./env";
import { checkAmount } from "./money";
import { REFERENCE_ID, approvalLink, dropUndefined, sdkAmount, sdkItem, sdkShipping } from "./orders";
import type { Transport } from "./transport";

/**
 * How a saved wallet will be charged. UNSCHEDULED_PREPAID: billed up front at
 * varying amounts and times, which fits purchases an agent makes for the buyer.
 */
export const DEFAULT_USAGE_PATTERN = "UNSCHEDULED_PREPAID";

export interface VaultSetupParams {
  /** Merchant the wallet is saved for (merchant-level vaulting); omit for first-party. */
  merchantId?: string;
  /** PayPal customer id from an earlier token, to link another wallet to the same buyer. */
  customerId?: string;
  /** Our id for the buyer, echoed back by PayPal. */
  merchantCustomerId?: string;
  /** Shown to the buyer on the approval page and in their PayPal account. */
  description?: string;
  usagePattern?: string;
  brandName?: string;
  returnUrl: string;
  cancelUrl: string;
  requestId: string;
}

interface Link {
  href: string;
  rel: string;
}

/** Starts saving the buyer's PayPal wallet (Vault v3); the buyer approves at `approveUrl`. */
export async function createVaultSetupToken(
  t: Transport,
  p: VaultSetupParams,
): Promise<{ setupTokenId: string; status: string; approveUrl: string; customerId?: string }> {
  const customer = dropUndefined({ id: p.customerId, merchant_customer_id: p.merchantCustomerId });
  const body = dropUndefined({
    customer: Object.keys(customer).length ? customer : undefined,
    payment_source: {
      paypal: dropUndefined({
        description: p.description,
        usage_pattern: p.usagePattern ?? DEFAULT_USAGE_PATTERN,
        usage_type: "MERCHANT",
        customer_type: "CONSUMER",
        experience_context: dropUndefined({
          brand_name: p.brandName,
          return_url: p.returnUrl,
          cancel_url: p.cancelUrl,
        }),
      }),
    },
  });
  const { data } = await t.request<{ id: string; status?: string; customer?: { id?: string }; links?: Link[] }>(
    "POST",
    "/v3/vault/setup-tokens",
    { json: body, headers: { ...t.merchantHeaders(p.merchantId), "PayPal-Request-Id": p.requestId } },
  );
  const approveUrl = approvalLink(data.links);
  if (!approveUrl) throw new Error(`vault setup token ${data.id} came back without an approval link`);
  return dropUndefined({
    setupTokenId: data.id,
    status: data.status ?? "UNKNOWN",
    approveUrl,
    customerId: data.customer?.id,
  });
}

/** Turns an approved setup token into a reusable payment token (`vaultId`). */
export async function createPaymentToken(
  t: Transport,
  p: { setupTokenId: string; merchantId?: string; requestId: string },
): Promise<{ vaultId: string; customerId?: string; payerId?: string; payerEmail?: string }> {
  const { data } = await t.request<{
    id: string;
    customer?: { id?: string };
    payment_source?: { paypal?: { payer_id?: string; email_address?: string } };
  }>("POST", "/v3/vault/payment-tokens", {
    json: { payment_source: { token: { id: p.setupTokenId, type: "SETUP_TOKEN" } } },
    headers: { ...t.merchantHeaders(p.merchantId), "PayPal-Request-Id": p.requestId },
  });
  return dropUndefined({
    vaultId: data.id,
    customerId: data.customer?.id,
    payerId: data.payment_source?.paypal?.payer_id,
    payerEmail: data.payment_source?.paypal?.email_address,
  });
}

export interface ChargeVaultedParams {
  vaultId: string;
  amount: Breakdown;
  items: OrderItem[];
  shipping?: OrderShipping;
  customId: string;
  requestId: string;
  merchantId?: string;
  /** Must match the pattern the wallet was saved with. */
  usagePattern?: string;
}

export interface ChargeVaultedResult {
  orderId: string;
  status: string;
  authorizationId: string;
  authorizationStatus?: string;
  payerId?: string;
}

/**
 * Merchant-initiated AUTHORIZE order against a saved wallet; no buyer
 * redirect. The authorization is captured or voided later like any other.
 */
export async function chargeVaulted(t: Transport, p: ChargeVaultedParams): Promise<ChargeVaultedResult> {
  checkAmount(p.amount, p.items);
  const body: OrderRequest = {
    intent: CheckoutPaymentIntent.Authorize,
    purchaseUnits: [
      {
        referenceId: REFERENCE_ID,
        customId: p.customId,
        amount: sdkAmount(p.amount),
        items: p.items.map((i) => sdkItem(i, p.amount.currency)),
        ...(p.shipping ? { shipping: sdkShipping(p.shipping) } : {}),
        ...(p.merchantId ? { payee: { merchantId: p.merchantId } } : {}),
      },
    ],
    paymentSource: {
      paypal: {
        vaultId: p.vaultId,
        storedCredential: {
          paymentInitiator: PaymentInitiator.Merchant,
          usage: StoredPaymentSourceUsageType.Subsequent,
          usagePattern: (p.usagePattern ?? DEFAULT_USAGE_PATTERN) as UsagePattern,
        },
      },
    },
  };
  const { result } = await t.sdkCall("POST /v2/checkout/orders", () =>
    t.orders.createOrder({
      body,
      paypalRequestId: p.requestId,
      prefer: "return=representation",
      paypalAuthAssertion: t.assertion(p.merchantId),
      paypalPartnerAttributionId: p.merchantId ? t.env.bnCode : undefined,
    }),
  );
  const auth = result.purchaseUnits?.[0]?.payments?.authorizations?.[0];
  if (!result.id || !auth?.id) {
    throw new Error(`vaulted charge ${result.id ?? "(no id)"} has no authorization (status ${result.status ?? "unknown"})`);
  }
  return dropUndefined({
    orderId: result.id,
    status: result.status ?? "UNKNOWN",
    authorizationId: auth.id,
    authorizationStatus: auth.status,
    payerId: result.paymentSource?.paypal?.accountId ?? result.payer?.payerId,
  });
}
