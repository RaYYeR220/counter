import { PayPalApiError, type Breakdown, type OrderItem, type OrderShipping, type PayPal } from "@counter/paypal";
import { fmt, type AuthorizeResult, type ComputedCartForPayment, type PaymentPort } from "@counter/store-sync";

/** Where each shop's money goes. A shop without a merchant id is paid to the platform account itself. */
/** `orders.paid_to` for a payment that went to the platform's own PayPal account. */
export const PAID_TO_PLATFORM = "platform";

/**
 * The PayPal account to act in for an order: the one it was paid to when that
 * is on record (a shop that connects PayPal later keeps its earlier orders on
 * the platform's account), else the shop's current account.
 */
export async function accountForOrder(
  order: { shopId: string; paidTo?: string | null },
  shops: Pick<ShopAccounts, "merchantIdFor">,
): Promise<string | undefined> {
  if (order.paidTo === PAID_TO_PLATFORM) return undefined;
  if (order.paidTo) return order.paidTo;
  return shops.merchantIdFor(order.shopId);
}

export interface ShopAccounts {
  merchantIdFor(shopId: string): Promise<string | undefined>;
  brandFor(shopId: string): Promise<string | undefined>;
}

export interface ReturnUrls {
  returnUrl(shopId: string): string;
  cancelUrl(shopId: string): string;
}

/**
 * Business outcomes of an authorize call. Anything else (auth, 5xx, malformed
 * requests) is an infrastructure failure and is rethrown.
 */
const DECLINE_ISSUES = new Set([
  "INSTRUMENT_DECLINED",
  "ORDER_NOT_APPROVED",
  "PAYER_ACTION_REQUIRED",
  "PAYER_CANNOT_PAY",
  "TRANSACTION_REFUSED",
  "COMPLIANCE_VIOLATION",
  "PAYEE_BLOCKED_TRANSACTION",
  "MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED",
  "AUTHORIZATION_DENIED",
  "PAYER_ACCOUNT_RESTRICTED",
  "PAYER_ACCOUNT_LOCKED_OR_CLOSED",
  "ORDER_EXPIRED",
]);

export function breakdownOf(cart: ComputedCartForPayment): Breakdown {
  const b: Breakdown = {
    currency: cart.currency,
    total: fmt(cart.totalCents),
    itemTotal: fmt(cart.subtotalCents),
    shipping: fmt(cart.shippingCents),
    taxTotal: fmt(cart.taxCents),
  };
  if (cart.discountCents > 0) b.discount = fmt(cart.discountCents);
  return b;
}

export function itemsOf(cart: ComputedCartForPayment): OrderItem[] {
  return cart.items.map((l) => ({
    name: l.name.slice(0, 127),
    quantity: l.quantity,
    unitAmount: fmt(l.unitCents),
    sku: l.variantId,
    url: l.url,
    category: "PHYSICAL_GOODS",
  }));
}

export function shippingOf(cart: ComputedCartForPayment): OrderShipping | undefined {
  const a = cart.shippingAddress;
  if (!a?.address_line_1 || !a.admin_area_2 || !a.postal_code || !a.country_code) return undefined;
  return {
    ...(cart.recipientName ? { fullName: cart.recipientName } : {}),
    address: {
      line1: a.address_line_1,
      ...(a.address_line_2 ? { line2: a.address_line_2 } : {}),
      city: a.admin_area_2,
      ...(a.admin_area_1 ? { state: a.admin_area_1 } : {}),
      postalCode: a.postal_code,
      countryCode: a.country_code,
    },
  };
}

/** Store Sync payment port backed by PayPal Orders v2 with authorize-now, capture-on-shipment. */
export class PayPalPayments implements PaymentPort {
  constructor(
    private readonly paypal: PayPal,
    private readonly shops: ShopAccounts,
    private readonly urls: ReturnUrls,
  ) {}

  async createOrder(shopId: string, cart: ComputedCartForPayment, requestId: string) {
    const merchantId = await this.shops.merchantIdFor(shopId);
    const brandName = await this.shops.brandFor(shopId);
    const shipping = shippingOf(cart);
    const out = await this.paypal.createAuthorizeOrder({
      ...(merchantId ? { merchantId } : {}),
      customId: cart.cartId,
      amount: breakdownOf(cart),
      items: itemsOf(cart),
      ...(shipping ? { shipping } : {}),
      returnUrl: this.urls.returnUrl(shopId),
      cancelUrl: this.urls.cancelUrl(shopId),
      requestId,
      ...(brandName ? { brandName } : {}),
    });
    return { orderId: out.id, approveUrl: out.approveUrl };
  }

  async patchOrder(shopId: string, orderId: string, cart: ComputedCartForPayment) {
    const merchantId = await this.shops.merchantIdFor(shopId);
    return this.paypal.patchOrder(orderId, merchantId, breakdownOf(cart), itemsOf(cart), shippingOf(cart));
  }

  async authorizeOrder(shopId: string, orderId: string, requestId: string): Promise<AuthorizeResult> {
    const merchantId = await this.shops.merchantIdFor(shopId);
    try {
      const r = await this.paypal.authorizeOrder(orderId, merchantId, requestId);
      if (r.authorizationStatus === "DENIED") return { status: "DECLINED", reason: "AUTHORIZATION_DENIED" };
      return { status: "COMPLETED", authorizationId: r.authorizationId, payerId: r.payerId, paidTo: merchantId ?? PAID_TO_PLATFORM };
    } catch (err) {
      if (err instanceof PayPalApiError && err.status === 422) {
        const issue = err.issues.find((i) => DECLINE_ISSUES.has(i));
        if (issue) return { status: "DECLINED", reason: issue };
      }
      throw err;
    }
  }
}
