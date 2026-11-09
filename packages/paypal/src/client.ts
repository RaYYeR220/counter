import {
  acceptClaim,
  getDispute,
  listDisputes,
  provideEvidence,
  type DisputeDetails,
  type DisputeView,
  type EvidenceParams,
  type ListDisputesQuery,
} from "./disputes";
import type { Breakdown, Money, OrderItem, OrderShipping, OrderView, PayPalEnv } from "./env";
import { captureAuthorization, refundCapture, voidAuthorization, type CaptureParams } from "./payments";
import {
  authorizeOrder,
  createAuthorizeOrder,
  getOrder,
  patchOrder,
  type AuthorizeResult,
  type CreateAuthorizeOrderParams,
} from "./orders";
import {
  createPartnerReferral,
  merchantIntegration,
  type MerchantRef,
  type MerchantStatus,
  type PartnerReferralParams,
} from "./partner";
import { addTracking, type TrackingParams } from "./tracking";
import { Transport } from "./transport";
import {
  chargeVaulted,
  createPaymentToken,
  createVaultSetupToken,
  type ChargeVaultedParams,
  type ChargeVaultedResult,
  type VaultSetupParams,
} from "./vault";
import { verifyWebhook } from "./webhooks";

/**
 * PayPal REST client for the Counter platform app. Passing `merchantId` makes
 * a call act for that onboarded merchant (auth assertion + BN code); leaving
 * it out calls PayPal as the app's own account.
 */
export class PayPal {
  private readonly t: Transport;

  constructor(env: PayPalEnv, fetchImpl: typeof fetch = globalThis.fetch, options: { now?: () => number } = {}) {
    this.t = new Transport(env, fetchImpl, options.now);
  }

  createAuthorizeOrder(p: CreateAuthorizeOrderParams): Promise<{ id: string; approveUrl: string }> {
    return createAuthorizeOrder(this.t, p);
  }

  patchOrder(
    orderId: string,
    merchantId: string | undefined,
    amount: Breakdown,
    items: OrderItem[],
    shipping?: OrderShipping,
  ): Promise<"ok" | "expired"> {
    return patchOrder(this.t, orderId, merchantId, amount, items, shipping);
  }

  getOrder(orderId: string, merchantId?: string): Promise<OrderView> {
    return getOrder(this.t, orderId, merchantId);
  }

  authorizeOrder(orderId: string, merchantId: string | undefined, requestId: string): Promise<AuthorizeResult> {
    return authorizeOrder(this.t, orderId, merchantId, requestId);
  }

  captureAuthorization(
    authId: string,
    merchantId: string | undefined,
    p: CaptureParams,
  ): Promise<{ captureId: string; status: string }> {
    return captureAuthorization(this.t, authId, merchantId, p);
  }

  voidAuthorization(authId: string, merchantId?: string, requestId?: string): Promise<void> {
    return voidAuthorization(this.t, authId, merchantId, requestId);
  }

  addTracking(orderId: string, merchantId: string | undefined, p: TrackingParams): Promise<void> {
    return addTracking(this.t, orderId, merchantId, p);
  }

  createPartnerReferral(p: PartnerReferralParams): Promise<{ actionUrl: string; selfUrl?: string }> {
    return createPartnerReferral(this.t, p);
  }

  merchantIntegration(trackingIdOrMerchantId: MerchantRef): Promise<MerchantStatus | null> {
    return merchantIntegration(this.t, trackingIdOrMerchantId);
  }

  verifyWebhook(headers: Record<string, string | undefined>, rawBody: string, webhookId: string): Promise<boolean> {
    return verifyWebhook(this.t, headers, rawBody, webhookId);
  }

  listDisputes(merchantId?: string, q?: ListDisputesQuery): Promise<{ items: DisputeView[]; nextPageToken?: string }> {
    return listDisputes(this.t, merchantId, q);
  }

  getDispute(disputeId: string, merchantId?: string): Promise<DisputeDetails> {
    return getDispute(this.t, disputeId, merchantId);
  }

  provideEvidence(disputeId: string, merchantId: string | undefined, p: EvidenceParams): Promise<void> {
    return provideEvidence(this.t, disputeId, merchantId, p);
  }

  acceptClaim(
    disputeId: string,
    merchantId: string | undefined,
    note: string,
    opts?: { acceptClaimType?: string },
  ): Promise<void> {
    return acceptClaim(this.t, disputeId, merchantId, note, opts);
  }

  createVaultSetupToken(
    p: VaultSetupParams,
  ): Promise<{ setupTokenId: string; status: string; approveUrl: string; customerId?: string }> {
    return createVaultSetupToken(this.t, p);
  }

  createPaymentToken(p: {
    setupTokenId: string;
    merchantId?: string;
    requestId: string;
  }): Promise<{ vaultId: string; customerId?: string; payerId?: string; payerEmail?: string }> {
    return createPaymentToken(this.t, p);
  }

  chargeVaulted(p: ChargeVaultedParams): Promise<ChargeVaultedResult> {
    return chargeVaulted(this.t, p);
  }

  refundCapture(
    captureId: string,
    merchantId: string | undefined,
    p: { amount?: Money; requestId: string },
  ): Promise<{ refundId: string; status: string }> {
    return refundCapture(this.t, captureId, merchantId, p);
  }
}
