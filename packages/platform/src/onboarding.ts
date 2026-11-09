import { getShop, logEvent, shops, type Db } from "@counter/db";
import type { MerchantStatus, PayPal } from "@counter/paypal";
import { eq } from "drizzle-orm";
import { PlatformError } from "./errors";

const TRACKING_PREFIX = "counter-";

/**
 * Permissions a shop grants Counter during PayPal signup: take payments
 * (authorize now, capture on shipment), refund, take the platform fee, read
 * the seller's status, read and answer disputes, and add shipment tracking.
 */
export const ONBOARDING_FEATURES = [
  "PAYMENT",
  "REFUND",
  "PARTNER_FEE",
  "ACCESS_MERCHANT_INFORMATION",
  "READ_SELLER_DISPUTE",
  "UPDATE_SELLER_DISPUTE",
  // PayPal refuses TRACKING_SHIPMENT_READWRITE for partner referrals in sandbox
  // (FEATURES_UNAUTHORIZED); tracking is added with the payment permission instead.
] as const;

export type OnboardingStatus = "active" | "pending";

/** Our id for a shop in PayPal's onboarding: `counter-<slug>`. */
export function trackingIdFor(shopSlug: string): string {
  return `${TRACKING_PREFIX}${shopSlug}`;
}

/** The shop slug in a tracking id made by `trackingIdFor`, or null. */
export function slugFromTrackingId(trackingId: string | null | undefined): string | null {
  if (!trackingId?.startsWith(TRACKING_PREFIX) || trackingId.length === TRACKING_PREFIX.length) return null;
  return trackingId.slice(TRACKING_PREFIX.length);
}

/** A shop is active once its seller account can take payments and the seller confirmed their email. */
export function onboardingStatusOf(status: MerchantStatus | null): OnboardingStatus {
  return status?.paymentsReceivable && status.primaryEmailConfirmed ? "active" : "pending";
}

/** Creates the PayPal signup link a shop owner follows to connect their PayPal account. */
export async function startOnboarding(
  paypal: PayPal,
  p: { shopSlug: string; returnUrl: string; email?: string },
): Promise<{ actionUrl: string; trackingId: string }> {
  const trackingId = trackingIdFor(p.shopSlug);
  const { actionUrl } = await paypal.createPartnerReferral({
    trackingId,
    returnUrl: p.returnUrl,
    features: ONBOARDING_FEATURES,
    ...(p.email ? { email: p.email } : {}),
  });
  return { actionUrl, trackingId };
}

export interface OnboardingResult {
  shopSlug: string;
  merchantId: string | null;
  status: OnboardingStatus;
  paymentsReceivable: boolean;
  primaryEmailConfirmed: boolean;
}

/**
 * Records the outcome of a shop's PayPal signup. The seller is looked up by
 * the shop's tracking id, which only Counter's signup link carries, so a
 * merchant id on the return URL is never trusted on its own: it is used only
 * when PayPal confirms it signed up through this shop's link.
 */
export async function completeOnboarding(
  db: Db,
  paypal: PayPal,
  p: { shopSlug: string; merchantIdInPayPal?: string },
): Promise<OnboardingResult> {
  const shop = await getShop(db, p.shopSlug);
  if (!shop) throw new PlatformError("not_found", `No shop ${p.shopSlug}`);
  const trackingId = trackingIdFor(shop.slug);
  const claimed = p.merchantIdInPayPal?.trim() || undefined;

  let status = await paypal.merchantIntegration({ trackingId });
  if (status && claimed && status.merchantId !== claimed) {
    throw new PlatformError("conflict", `PayPal links ${shop.slug} to a different merchant than ${claimed}`);
  }
  if (!status && claimed) {
    const byId = await paypal.merchantIntegration({ merchantId: claimed });
    if (byId && byId.trackingId !== trackingId) {
      throw new PlatformError("conflict", `Merchant ${claimed} did not sign up through ${shop.slug}'s onboarding link`);
    }
    status = byId;
  }

  const state = onboardingStatusOf(status);
  await db
    .update(shops)
    .set({ onboardingStatus: state, ...(status ? { paypalMerchantId: status.merchantId } : {}) })
    .where(eq(shops.id, shop.id));
  const result: OnboardingResult = {
    shopSlug: shop.slug,
    merchantId: status?.merchantId ?? shop.paypalMerchantId ?? null,
    status: state,
    paymentsReceivable: status?.paymentsReceivable ?? false,
    primaryEmailConfirmed: status?.primaryEmailConfirmed ?? false,
  };
  await logEvent(db, shop.slug, "shop.onboarding", shop.slug, {
    status: state,
    merchant_id: result.merchantId,
    payments_receivable: result.paymentsReceivable,
    primary_email_confirmed: result.primaryEmailConfirmed,
    scopes: status?.scopes.length ?? 0,
  });
  return result;
}
