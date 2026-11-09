import {
  CheckoutPaymentIntent,
  ItemCategory,
  PaypalExperienceUserAction,
  PaypalWalletContextShippingPreference,
  type AmountWithBreakdown,
  type ItemRequest,
  type LinkDescription,
  type OrderRequest,
  type ShippingDetails,
} from "@paypal/paypal-server-sdk";
import type { Breakdown, OrderItem, OrderShipping } from "./env";
import { checkAmount } from "./money";
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

export function dropUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
