import "server-only";
import { logEvent, withCartRetry } from "@counter/db";
import { PayPalPayments } from "@counter/platform";
import { checkoutCart, createCart, toCents, type PayPalCart, type StoreSyncDeps, type ValidationIssue } from "@counter/store-sync";
import { baseUrl, db, paymentsStubbed, paypal, shopAccounts, STUB_PAYER_ID, storeSyncDeps } from "@/lib/server/runtime";
import { storeSyncCart, type QuoteRequest } from "./pricing";
import type { QuoteIssue } from "./types";

export const STOREFRONT_CLIENT = "Storefront";

/**
 * PayPal can be called only once the platform's REST credentials are set.
 * Local runs with `PAYMENTS_MODE=stub` use the stub payment port instead.
 */
export function paymentsConfigured(): boolean {
  return paymentsStubbed() || Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function shopPath(slug: string, path: string): string {
  return `${baseUrl()}/s/${encodeURIComponent(slug)}${path}`;
}

/**
 * Store Sync dependencies for first-party storefront checkouts. Same catalog,
 * carts, orders and PayPal account as the agent API; only the PayPal return
 * and cancel pages differ, so the buyer comes back to the shop.
 */
export function storefrontDeps(): StoreSyncDeps {
  if (paymentsStubbed()) return storeSyncDeps();
  return {
    ...storeSyncDeps(),
    payments: new PayPalPayments(paypal(), shopAccounts, {
      returnUrl: (slug) => shopPath(slug, "/checkout/complete"),
      cancelUrl: (slug) => shopPath(slug, "/cart?checkout=cancelled"),
    }),
  };
}

function issuesOf(body: unknown): QuoteIssue[] {
  const b = body as { validation_issues?: ValidationIssue[]; details?: Array<{ business_context?: ValidationIssue }> } | undefined;
  const list =
    b?.validation_issues ?? (b?.details ?? []).flatMap((d) => (d.business_context ? [d.business_context] : []));
  return list.map((i) => ({
    ...(i.variant_id ? { variant_id: i.variant_id } : {}),
    code: String((i.context as { specific_issue?: string } | undefined)?.specific_issue ?? i.code),
    message: i.user_message ?? i.message,
  }));
}

export type StartResult =
  | { ok: true; cartId: string; approvalUrl: string; totalCents: number | null }
  | { ok: false; kind: "invalid"; issues: QuoteIssue[] }
  | { ok: false; kind: "error"; message: string };

/**
 * Turns a storefront cart into a Store Sync cart. A valid cart gets a PayPal
 * order (intent AUTHORIZE) and an approval link for the buyer.
 */
export async function startCheckout(slug: string, req: QuoteRequest): Promise<StartResult> {
  const deps = storefrontDeps();
  const body = storeSyncCart(req);
  const started = Date.now();
  const result = await withCartRetry(deps, (d) => createCart(slug, body, d, { clientIdentifier: STOREFRONT_CLIENT }));
  const out = result.body as PayPalCart & { name?: string; message?: string };

  await logEvent(db(), slug, "cart.created", out?.id ?? null, {
    http: result.status,
    status: out?.status,
    validation_status: out?.validation_status,
    total: out?.totals?.total?.value,
    paypal_order_id: out?.payment_method?.token,
    agent: STOREFRONT_CLIENT,
    ms: Date.now() - started,
  }).catch((err) => console.error("event log failed", err));

  if (result.status === 201 && out.id && out.payment_method?.approval_url) {
    const total = out.totals?.total?.value;
    // With stubbed payments there is no PayPal page; the order counts as approved straight away.
    const approvalUrl =
      paymentsStubbed() && out.payment_method.token
        ? shopPath(slug, `/checkout/complete?token=${encodeURIComponent(out.payment_method.token)}&PayerID=${STUB_PAYER_ID}`)
        : out.payment_method.approval_url;
    return {
      ok: true,
      cartId: out.id,
      approvalUrl,
      totalCents: total ? toCents(total) : null,
    };
  }
  if (result.status === 200 || result.status === 422) {
    const issues = issuesOf(out);
    if (issues.length) return { ok: false, kind: "invalid", issues };
  }
  if (result.status >= 500) {
    return { ok: false, kind: "error", message: "PayPal didn't respond. Your cart is saved; try again in a minute." };
  }
  return { ok: false, kind: "error", message: out?.message ?? "Checkout couldn't start. Your cart is saved; try again." };
}

export type CompleteResult =
  | { ok: true; orderNumber: string }
  | { ok: false; reason: "unknown" | "declined" | "expired" | "invalid" | "error" };

/** Cart that holds a PayPal order, for the return from PayPal. */
async function cartForPayPalOrder(slug: string, token: string) {
  return db().query.carts.findFirst({
    columns: { id: true, status: true },
    where: (c, { and, eq }) => and(eq(c.shopId, slug), eq(c.paypalOrderId, token)),
  });
}

/**
 * The buyer approved the PayPal order: authorize it through Store Sync's
 * checkout and book the merchant order. Safe to repeat; a completed cart
 * answers with the order it already booked.
 */
export async function completeCheckout(slug: string, token: string, payerId: string | null): Promise<CompleteResult> {
  const cart = await cartForPayPalOrder(slug, token);
  if (!cart) return { ok: false, reason: "unknown" };

  const deps = storefrontDeps();
  const started = Date.now();
  const result = await withCartRetry(deps, (d) =>
    checkoutCart(slug, cart.id, { payment_method: { type: "paypal", token, ...(payerId ? { payer_id: payerId } : {}) } }, d),
  );
  const out = result.body as
    | (PayPalCart & { payment_confirmation?: { merchant_order_number?: string } })
    | { name?: string; details?: Array<{ issue?: string }> }
    | undefined;

  await logEvent(db(), slug, "cart.checkout", cart.id, {
    http: result.status,
    status: (out as PayPalCart | undefined)?.status,
    paypal_order_id: token,
    agent: STOREFRONT_CLIENT,
    ms: Date.now() - started,
  }).catch((err) => console.error("event log failed", err));

  const orderNumber = (out as { payment_confirmation?: { merchant_order_number?: string } } | undefined)?.payment_confirmation
    ?.merchant_order_number;
  if (result.status === 200 && orderNumber) return { ok: true, orderNumber };
  if (result.status === 200) return { ok: false, reason: "invalid" };
  if (result.status === 422) {
    const codes = ((out as { details?: Array<{ issue?: string }> }).details ?? []).map((d) => d.issue);
    return { ok: false, reason: codes.includes("PAYMENT_EXPIRED") ? "expired" : "declined" };
  }
  return { ok: false, reason: "error" };
}
