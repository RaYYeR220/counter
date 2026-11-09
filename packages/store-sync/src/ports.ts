import type { CatalogPort } from "./catalog";
import type { AppliedDiscountIn, CartStatus } from "./compute";
import type { Cents } from "./money";
import type { Address, PayPalCart } from "./types";

/** A cart as persisted by the merchant. `cart` is the last body returned for it. */
export interface CartRecord {
  id: string;
  shopId: string;
  status: CartStatus;
  cart: PayPalCart;
  /** PayPal Orders v2 id, returned to the platform as `payment_method.token`. */
  paypalOrderId?: string;
  /** Order total last sent to PayPal. */
  lastTotalCents?: number;
  /** Exact checkout response, replayed when the same checkout is retried. */
  completedResponse?: object;
  /** Which agent platform created the cart (from the token's `Client_Identifier`). */
  agentClient?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartRepo {
  insert(r: CartRecord): Promise<void>;
  get(shopId: string, id: string): Promise<CartRecord | null>;
  update(r: CartRecord): Promise<void>;
}

export interface PaymentLine {
  variantId: string;
  parentId: string;
  name: string;
  url: string;
  quantity: number;
  unitCents: Cents;
}

/** Everything the payment side needs to mirror a priced cart as a PayPal order. */
export interface ComputedCartForPayment {
  cartId: string;
  currency: "USD";
  items: PaymentLine[];
  subtotalCents: Cents;
  discountCents: Cents;
  shippingCents: Cents;
  taxCents: Cents;
  /** subtotal - discount + shipping + tax */
  totalCents: Cents;
  shippingAddress?: Address;
  recipientName?: string;
  shippingOptionId?: string;
}

export type AuthorizeResult =
  | { status: "COMPLETED"; authorizationId: string; payerId: string }
  | { status: "DECLINED"; reason: string };

/**
 * The merchant's PayPal integration. Implementations should pass `requestId`
 * as `PayPal-Request-Id` so retried calls are idempotent.
 */
export interface PaymentPort {
  createOrder(shopId: string, cart: ComputedCartForPayment, requestId: string): Promise<{ orderId: string; approveUrl: string }>;
  /** Brings an existing order in line with the cart; `expired` when PayPal no longer knows the order. */
  patchOrder(shopId: string, orderId: string, cart: ComputedCartForPayment): Promise<"ok" | "expired">;
  authorizeOrder(shopId: string, orderId: string, requestId: string): Promise<AuthorizeResult>;
}

/**
 * Receives authorized carts and books them as merchant orders. A checkout can
 * be retried after a failure, so this must be idempotent per cart id.
 */
export interface OrderSink {
  onCompleted(
    r: CartRecord,
    auth: { authorizationId: string; payerId: string },
  ): Promise<{ merchantOrderNumber: string; orderReviewPage: string }>;
}

/** Supplies merchant-granted discounts (for example, negotiated deals) for a cart. */
export interface DiscountPort {
  forCart(
    shopId: string,
    q: { cartId: string | undefined; cart: PayPalCart; agentClient: string | undefined },
  ): Promise<AppliedDiscountIn[]>;
}

export interface StoreSyncDeps {
  catalog: CatalogPort;
  carts: CartRepo;
  payments: PaymentPort;
  orders: OrderSink;
  now: () => Date;
  /** Returns ids shaped CART-[A-Z0-9]{10}. */
  newCartId: () => string;
  discounts?: DiscountPort;
  /** Called with unexpected failures that were answered with a 5xx. */
  onError?: (err: unknown, where: { op: string; shopId: string; cartId?: string }) => void;
}
