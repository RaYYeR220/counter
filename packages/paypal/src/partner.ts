import { PayPalApiError } from "./errors";
import { dropUndefined } from "./orders";
import type { Transport } from "./transport";

/**
 * Permissions a seller grants the platform during onboarding. They must match
 * the features enabled on the platform's REST app, or onboarding fails.
 */
export const DEFAULT_REFERRAL_FEATURES = [
  "PAYMENT",
  "REFUND",
  "PARTNER_FEE",
  "DELAY_FUNDS_DISBURSEMENT",
  "ACCESS_MERCHANT_INFORMATION",
  "READ_SELLER_DISPUTE",
  "UPDATE_SELLER_DISPUTE",
  "ADVANCED_TRANSACTIONS_SEARCH",
] as const;

export interface PartnerReferralParams {
  /** Our id for the seller; PayPal returns it on the return URL and in status lookups. */
  trackingId: string;
  /** Where PayPal sends the seller after signup. */
  returnUrl: string;
  email?: string;
  /** Overrides DEFAULT_REFERRAL_FEATURES. */
  features?: readonly string[];
  /** Also request merchant-level PayPal wallet vaulting. */
  vaulting?: boolean;
}

interface Link {
  href: string;
  rel: string;
}

/** Creates a seller signup link (Partner Referrals v2). */
export async function createPartnerReferral(
  t: Transport,
  p: PartnerReferralParams,
): Promise<{ actionUrl: string; selfUrl?: string }> {
  const features = [...(p.features ?? DEFAULT_REFERRAL_FEATURES)];
  const products = ["EXPRESS_CHECKOUT"];
  if (p.vaulting) {
    for (const f of ["VAULT", "BILLING_AGREEMENT"]) if (!features.includes(f)) features.push(f);
    products.push("ADVANCED_VAULTING");
  }
  const body = dropUndefined({
    tracking_id: p.trackingId,
    email: p.email,
    partner_config_override: { return_url: p.returnUrl },
    operations: [
      {
        operation: "API_INTEGRATION",
        api_integration_preference: {
          rest_api_integration: {
            integration_method: "PAYPAL",
            integration_type: "THIRD_PARTY",
            third_party_details: { features },
          },
        },
      },
    ],
    products,
    capabilities: p.vaulting ? ["PAYPAL_WALLET_VAULTING_ADVANCED"] : undefined,
    legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
  });
  const { data } = await t.request<{ links?: Link[] }>("POST", "/v2/customer/partner-referrals", {
    json: body,
    headers: t.partnerHeaders(),
  });
  const actionUrl = data.links?.find((l) => l.rel === "action_url")?.href;
  if (!actionUrl) throw new Error("partner referral response has no action_url link");
  const selfUrl = data.links?.find((l) => l.rel === "self")?.href;
  return dropUndefined({ actionUrl, selfUrl });
}

export interface MerchantStatus {
  merchantId: string;
  trackingId?: string;
  /** False until the seller can take payments (e.g. account limits, unconfirmed setup). */
  paymentsReceivable: boolean;
  primaryEmailConfirmed: boolean;
  legalName?: string;
  country?: string;
  products: { name: string; status?: string; vettingStatus?: string }[];
  /** OAuth scopes the seller granted to this platform. */
  scopes: string[];
}

export type MerchantRef = string | { trackingId: string } | { merchantId: string };

/** PayPal merchant ids are 13 upper-case alphanumerics, e.g. 5VT3RDX64P5Z6. */
const MERCHANT_ID = /^[A-Z0-9]{13}$/;

interface StatusWire {
  merchant_id: string;
  tracking_id?: string;
  payments_receivable?: boolean;
  primary_email_confirmed?: boolean;
  legal_name?: string;
  country?: string;
  products?: { name: string; status?: string; vetting_status?: string }[];
  oauth_integrations?: { oauth_third_party?: { partner_client_id?: string; scopes?: string[] }[] }[];
}

/**
 * Seller onboarding status. A string is read as a merchant id when it looks
 * like one, otherwise as a tracking id. Returns null when PayPal has no seller
 * for the tracking id yet.
 */
export async function merchantIntegration(t: Transport, ref: MerchantRef): Promise<MerchantStatus | null> {
  const partnerId = t.env.partnerMerchantId;
  if (!partnerId) throw new Error("merchantIntegration needs env.partnerMerchantId (the platform's PayPal merchant id)");
  const base = `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations`;
  const headers = t.partnerHeaders();

  const resolved: { trackingId: string } | { merchantId: string } =
    typeof ref !== "string" ? ref : MERCHANT_ID.test(ref) ? { merchantId: ref } : { trackingId: ref };

  let merchantId: string;
  if ("merchantId" in resolved) {
    merchantId = resolved.merchantId;
  } else {
    try {
      const { data } = await t.request<{ merchant_id?: string } | { merchant_id?: string }[]>("GET", base, {
        query: { tracking_id: resolved.trackingId },
        headers,
      });
      const found = Array.isArray(data) ? data[0]?.merchant_id : data?.merchant_id;
      if (!found) return null;
      merchantId = found;
    } catch (e) {
      if (e instanceof PayPalApiError && e.status === 404) return null;
      throw e;
    }
  }

  const { data: s } = await t.request<StatusWire>("GET", `${base}/${encodeURIComponent(merchantId)}`, { headers });
  const grants = (s.oauth_integrations ?? []).flatMap((i) => i.oauth_third_party ?? []);
  const ours = grants.filter((g) => !g.partner_client_id || g.partner_client_id === t.env.clientId);
  return dropUndefined({
    merchantId: s.merchant_id ?? merchantId,
    trackingId: s.tracking_id,
    paymentsReceivable: s.payments_receivable === true,
    primaryEmailConfirmed: s.primary_email_confirmed === true,
    legalName: s.legal_name,
    country: s.country,
    products: (s.products ?? []).map((pr) =>
      dropUndefined({ name: pr.name, status: pr.status, vettingStatus: pr.vetting_status }),
    ),
    scopes: [...new Set(ours.flatMap((g) => g.scopes ?? []))],
  });
}
