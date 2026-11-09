import {
  CheckoutPaymentIntent,
  ItemCategory,
  PatchOp,
  PaypalExperienceUserAction,
  PaypalWalletContextShippingPreference,
  type AmountWithBreakdown,
  type ItemRequest,
  type LinkDescription,
  type OrderRequest,
  type Patch,
  type ShippingDetails,
} from "@paypal/paypal-server-sdk";
import type { Breakdown, OrderItem, OrderShipping, OrderView, ShippingAddress } from "./env";
import { PayPalApiError } from "./errors";
import { checkAmount, wireMoney } from "./money";
import type { Transport } from "./transport";

/** Single purchase unit per order; PATCH paths address it by this id. */
export const REFERENCE_ID = "default";

export interface CreateAuthorizeOrderParams {
  /** Onboarded merchant receiving the funds; omit for first-party calls. */
  merchantId?: string;
  /** Our cart id, echoed back by PayPal on the order and its payments. */
  customId: string;
  amount: Breakdown;
  items: OrderItem[];
  shipping?: OrderShipping;
  returnUrl: string;
  cancelUrl: string;
  /** Idempotency key, e.g. `<cartId>-create`. */
  requestId: string;
  /** Shown to the buyer on the PayPal approval page. */
  brandName?: string;
}

export async function createAuthorizeOrder(
  t: Transport,
  p: CreateAuthorizeOrderParams,
): Promise<{ id: string; approveUrl: string }> {
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
        experienceContext: {
          ...(p.brandName ? { brandName: p.brandName } : {}),
          shippingPreference: p.shipping
            ? PaypalWalletContextShippingPreference.SetProvidedAddress
            : PaypalWalletContextShippingPreference.GetFromFile,
          userAction: PaypalExperienceUserAction.PayNow,
          returnUrl: p.returnUrl,
          cancelUrl: p.cancelUrl,
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
  const approveUrl = approvalLink(result.links);
  if (!result.id || !approveUrl) {
    throw new Error(`PayPal order ${result.id ?? "(no id)"} came back without an approval link`);
  }
  return { id: result.id, approveUrl };
}

const UNIT = `/purchase_units/@reference_id=='${REFERENCE_ID}'`;

/** 422 issues meaning the order can no longer take this change; a new order is needed. */
const DEAD_ORDER_ISSUES = [
  "ORDER_ALREADY_COMPLETED",
  "ORDER_COMPLETED_OR_VOIDED",
  "ORDER_EXPIRED",
  "AMOUNT_CHANGE_NOT_ALLOWED",
  "AMOUNT_NOT_PATCHABLE",
];

/**
 * Replaces items and amount (and the address, when given) on the order's
 * purchase unit. Returns `'expired'` when PayPal no longer has the order or
 * refuses changes to it, so the caller can open a fresh one.
 */
export async function patchOrder(
  t: Transport,
  orderId: string,
  merchantId: string | undefined,
  amount: Breakdown,
  items: OrderItem[],
  shipping?: OrderShipping,
): Promise<"ok" | "expired"> {
  checkAmount(amount, items);
  const ops: Patch[] = [
    { op: PatchOp.Replace, path: `${UNIT}/items`, value: items.map((i) => wireItem(i, amount.currency)) },
    { op: PatchOp.Replace, path: `${UNIT}/amount`, value: wireAmount(amount) },
  ];
  if (shipping) ops.push({ op: PatchOp.Replace, path: `${UNIT}/shipping/address`, value: wireAddress(shipping.address) });
  try {
    await t.sdkCall(`PATCH /v2/checkout/orders/${orderId}`, () =>
      t.orders.patchOrder({ id: orderId, body: ops, paypalAuthAssertion: t.assertion(merchantId) }),
    );
    return "ok";
  } catch (e) {
    if (e instanceof PayPalApiError) {
      if (e.status === 404) return "expired";
      if (e.status === 422 && DEAD_ORDER_ISSUES.some((i) => e.has(i))) return "expired";
    }
    throw e;
  }
}

export async function getOrder(t: Transport, orderId: string, merchantId?: string): Promise<OrderView> {
  const { result } = await t.sdkCall(`GET /v2/checkout/orders/${orderId}`, () =>
    t.orders.getOrder({ id: orderId, paypalAuthAssertion: t.assertion(merchantId) }),
  );
  const unit = result.purchaseUnits?.[0];
  const auth = unit?.payments?.authorizations?.[0];
  const capture = unit?.payments?.captures?.[0];
  return dropUndefined({
    id: result.id ?? orderId,
    status: result.status ?? "UNKNOWN",
    intent: result.intent,
    customId: unit?.customId,
    payerId: result.payer?.payerId ?? result.paymentSource?.paypal?.accountId,
    payerEmail: result.payer?.emailAddress ?? result.paymentSource?.paypal?.emailAddress,
    amount: unit?.amount ? { currency: unit.amount.currencyCode, value: unit.amount.value } : undefined,
    payeeMerchantId: unit?.payee?.merchantId,
    authorizationId: auth?.id,
    authorizationStatus: auth?.status,
    captureId: capture?.id,
    captureStatus: capture?.status,
    approveUrl: approvalLink(result.links),
  });
}

export interface AuthorizeResult {
  authorizationId: string;
  payerId: string;
  /** Order status, `COMPLETED` once authorized. */
  status: string;
  /** Authorization status: `CREATED`, `PENDING`, `DENIED`, ... */
  authorizationStatus?: string;
}

/** Authorizes a buyer-approved order. Funds are held until captured or voided. */
export async function authorizeOrder(
  t: Transport,
  orderId: string,
  merchantId: string | undefined,
  requestId: string,
): Promise<AuthorizeResult> {
  const { result } = await t.sdkCall(`POST /v2/checkout/orders/${orderId}/authorize`, () =>
    t.orders.authorizeOrder({
      id: orderId,
      body: {},
      paypalRequestId: requestId,
      prefer: "return=representation",
      paypalAuthAssertion: t.assertion(merchantId),
    }),
  );
  const auth = result.purchaseUnits?.[0]?.payments?.authorizations?.[0];
  if (!auth?.id) throw new Error(`PayPal order ${orderId} was authorized without an authorization id`);
  return dropUndefined({
    authorizationId: auth.id,
    payerId: result.payer?.payerId ?? result.paymentSource?.paypal?.accountId ?? "",
    status: result.status ?? "UNKNOWN",
    authorizationStatus: auth.status,
  });
}

/** The buyer approval URL: rel `approve`, or `payer-action` when experience_context is used. */
export function approvalLink(links: LinkDescription[] | undefined): string | undefined {
  return links?.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href;
}

export function sdkAmount(b: Breakdown): AmountWithBreakdown {
  const m = (value: string | undefined) => (value === undefined ? undefined : { currencyCode: b.currency, value });
  const breakdown = {
    itemTotal: m(b.itemTotal),
    shipping: m(b.shipping),
    handling: m(b.handling),
    taxTotal: m(b.taxTotal),
    insurance: m(b.insurance),
    shippingDiscount: m(b.shippingDiscount),
    discount: m(b.discount),
  };
  return { currencyCode: b.currency, value: b.total, breakdown: dropUndefined(breakdown) };
}

export function sdkItem(i: OrderItem, currency: string): ItemRequest {
  return dropUndefined({
    name: i.name,
    quantity: String(i.quantity),
    unitAmount: { currencyCode: currency, value: i.unitAmount },
    sku: i.sku,
    description: i.description,
    url: i.url,
    imageUrl: i.imageUrl,
    category: i.category as ItemCategory | undefined,
  }) as ItemRequest;
}

export function sdkShipping(s: OrderShipping): ShippingDetails {
  return {
    ...(s.fullName ? { name: { fullName: s.fullName } } : {}),
    address: dropUndefined({
      addressLine1: s.address.line1,
      addressLine2: s.address.line2,
      adminArea2: s.address.city,
      adminArea1: s.address.state,
      postalCode: s.address.postalCode,
      countryCode: s.address.countryCode,
    }) as ShippingDetails["address"],
  };
}

/** Orders v2 JSON for a purchase-unit amount (PATCH values bypass the SDK models). */
export function wireAmount(b: Breakdown) {
  const m = (value: string | undefined) => (value === undefined ? undefined : wireMoney(b.currency, value));
  return {
    ...wireMoney(b.currency, b.total),
    breakdown: dropUndefined({
      item_total: m(b.itemTotal),
      shipping: m(b.shipping),
      handling: m(b.handling),
      tax_total: m(b.taxTotal),
      insurance: m(b.insurance),
      shipping_discount: m(b.shippingDiscount),
      discount: m(b.discount),
    }),
  };
}

export function wireItem(i: OrderItem, currency: string) {
  return dropUndefined({
    name: i.name,
    quantity: String(i.quantity),
    unit_amount: wireMoney(currency, i.unitAmount),
    sku: i.sku,
    description: i.description,
    url: i.url,
    image_url: i.imageUrl,
    category: i.category,
  });
}

export function wireAddress(a: ShippingAddress) {
  return dropUndefined({
    address_line_1: a.line1,
    address_line_2: a.line2,
    admin_area_2: a.city,
    admin_area_1: a.state,
    postal_code: a.postalCode,
    country_code: a.countryCode,
  });
}

export function dropUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
