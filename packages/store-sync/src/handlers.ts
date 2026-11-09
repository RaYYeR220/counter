import { assembleCart, computeCart, type CartStatus, type ComputedCart } from "./compute";
import {
  businessError,
  cartNotFound,
  internalError,
  invalidCartId,
  invalidRequest,
  type HandlerResult,
} from "./errors";
import { cartAlreadyCompleted, paymentDeclined, paymentExpired } from "./issues";
import type { CartRecord, ComputedCartForPayment, StoreSyncDeps } from "./ports";
import type { Address, PaymentMethod, PayPalCart } from "./types";
import { parseCartRequest } from "./validate";

// ---------------------------------------------------------------------------
// Cart ids

const CART_ID = /^CART-[A-Z0-9][A-Z0-9-]{0,63}$/;
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function isWellFormedCartId(id: string): boolean {
  return CART_ID.test(id);
}

/** A fresh cart id: `CART-` followed by 10 random upper-case alphanumerics. */
export function randomCartId(): string {
  let out = "";
  const buf = new Uint8Array(16);
  while (out.length < 10) {
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      // 252 is the largest multiple of 36 below 256; rejecting above it keeps the draw uniform.
      if (b < 252 && out.length < 10) out += ID_ALPHABET[b % 36];
    }
  }
  return `CART-${out}`;
}

// ---------------------------------------------------------------------------
// Plumbing

/** A failure in a downstream system, reported to the caller as a named 500. */
class ServiceFailure extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    cause: unknown,
  ) {
    super(publicMessage, { cause });
  }
}

async function viaPayPal<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new ServiceFailure(
      "PAYMENT_PROCESSOR_UNAVAILABLE",
      "The payment processor is temporarily unavailable. Please try again.",
      cause,
    );
  }
}

async function viaOrderSystem<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new ServiceFailure("ORDER_SYSTEM_ERROR", "The order could not be recorded. Please retry checkout.", cause);
  }
}

async function guarded(
  deps: StoreSyncDeps,
  where: { op: string; shopId: string; cartId?: string },
  fn: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceFailure) {
      deps.onError?.(err.cause ?? err, where);
      return internalError(err.code, err.publicMessage);
    }
    deps.onError?.(err, where);
    return internalError();
  }
}

/**
 * Runs operations on the same cart one after another (in arrival order), so
 * retried or overlapping requests from the platform cannot interleave their
 * reads and writes within this process.
 */
const tails = new Map<string, Promise<void>>();
async function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

function lockKey(shopId: string, cartId: string): string {
  return `${shopId}\u0000${cartId}`;
}

// ---------------------------------------------------------------------------
// Pricing and payment sync

async function price(
  shopId: string,
  cartId: string | undefined,
  input: PayPalCart,
  agentClient: string | undefined,
  deps: StoreSyncDeps,
): Promise<ComputedCart> {
  const discounts = deps.discounts ? await deps.discounts.forCart(shopId, { cartId, cart: input, agentClient }) : [];
  return computeCart(input, deps.catalog, shopId, { now: deps.now(), discounts });
}

function paymentCart(cartId: string, input: PayPalCart, c: ComputedCart): ComputedCartForPayment {
  const name = [input.customer?.name?.given_name, input.customer?.name?.surname].filter(Boolean).join(" ");
  return {
    cartId,
    currency: "USD",
    items: c.lines.map(({ variantId, parentId, name, url, quantity, unitCents }) => ({
      variantId,
      parentId,
      name,
      url,
      quantity,
      unitCents,
    })),
    subtotalCents: c.amounts.subtotal,
    discountCents: c.amounts.discount,
    shippingCents: c.amounts.shipping,
    taxCents: c.amounts.tax,
    totalCents: c.amounts.total,
    ...(input.shipping_address ? { shippingAddress: input.shipping_address } : {}),
    ...(name ? { recipientName: name } : {}),
    ...(c.selectedShipping ? { shippingOptionId: c.selectedShipping.id } : {}),
  };
}

function linesKey(items: PayPalCart["items"]): string {
  return JSON.stringify((items ?? []).map((i) => [i.variant_id, i.quantity, i.price?.value]));
}

function addressKey(a: Address | null | undefined): string {
  if (!a) return "";
  return JSON.stringify(
    [a.address_line_1, a.address_line_2, a.admin_area_2, a.admin_area_1, a.postal_code, a.country_code].map(
      (v) => v ?? "",
    ),
  );
}

/** True when the PayPal order already reflects this priced cart. */
function orderInSync(record: CartRecord, input: PayPalCart, c: ComputedCart): boolean {
  // Only a CREATED record was synced when it was stored.
  if (record.status !== "CREATED" || record.lastTotalCents !== c.amounts.total) return false;
  return (
    linesKey(record.cart.items) === linesKey(c.items) &&
    addressKey(record.cart.shipping_address) === addressKey(input.shipping_address)
  );
}

function storedApprovalUrl(record: CartRecord): string | undefined {
  const pm = record.cart.payment_method;
  return pm?.token && pm.token === record.paypalOrderId ? (pm.approval_url ?? undefined) : undefined;
}

interface OrderRef {
  orderId: string;
  approvalUrl: string | undefined;
  /** The previous order had expired and was replaced by this one. */
  replaced: boolean;
}

/** Creates the PayPal order for a valid cart, or brings the existing one up to date. */
async function syncOrder(
  shopId: string,
  record: CartRecord,
  input: PayPalCart,
  c: ComputedCart,
  deps: StoreSyncDeps,
): Promise<OrderRef> {
  const pay = paymentCart(record.id, input, c);
  const existing = record.paypalOrderId;
  if (!existing) {
    const o = await viaPayPal(() => deps.payments.createOrder(shopId, pay, `${record.id}-create`));
    return { orderId: o.orderId, approvalUrl: o.approveUrl, replaced: false };
  }
  const current: OrderRef = { orderId: existing, approvalUrl: storedApprovalUrl(record), replaced: false };
  if (orderInSync(record, input, c)) return current;
  const outcome = await viaPayPal(() => deps.payments.patchOrder(shopId, existing, pay));
  if (outcome === "ok") return current;
  // PayPal no longer has the order: start a new one under a request id unique to the expired order.
  const o = await viaPayPal(() => deps.payments.createOrder(shopId, pay, `${record.id}-recreate-${existing}`));
  return { orderId: o.orderId, approvalUrl: o.approveUrl, replaced: true };
}

function paymentMethod(orderId: string | undefined, approvalUrl: string | undefined): PaymentMethod | undefined {
  if (!orderId) return undefined;
  return { type: "paypal", token: orderId, ...(approvalUrl ? { approval_url: approvalUrl } : {}) };
}

/** The record after applying a priced cart (and, for a valid cart, its synced order). */
function nextRecord(
  record: CartRecord,
  input: PayPalCart,
  c: ComputedCart,
  deps: StoreSyncDeps,
  order?: OrderRef,
): CartRecord {
  const valid = c.validationStatus === "VALID";
  const status: CartStatus = valid ? "CREATED" : "INCOMPLETE";
  const orderId = order?.orderId ?? record.paypalOrderId;
  const approvalUrl = order ? order.approvalUrl : storedApprovalUrl(record);
  const cart = assembleCart(input, c, { id: record.id, status, paymentMethod: paymentMethod(orderId, approvalUrl) });
  return {
    ...record,
    status,
    cart,
    ...(orderId ? { paypalOrderId: orderId } : {}),
    ...(order ? { lastTotalCents: c.amounts.total } : {}),
    updatedAt: deps.now(),
  };
}

function declined(token: string, reason: string): HandlerResult {
  return businessError([paymentDeclined(token, reason)], "Payment was declined");
}

// ---------------------------------------------------------------------------
// Handlers

/** POST /merchant-cart */
export async function createCart(
  shopId: string,
  body: unknown,
  deps: StoreSyncDeps,
  ctx: { clientIdentifier?: string } = {},
): Promise<HandlerResult> {
  return guarded(deps, { op: "createCart", shopId }, async () => {
    const parsed = parseCartRequest(body);
    if (!parsed.ok) return { status: parsed.status, body: parsed.body };
    const input = parsed.cart;

    const c = await price(shopId, undefined, input, ctx.clientIdentifier, deps);
    if (c.resolvedCount === 0) {
      const n = input.items?.length ?? 0;
      return businessError(c.issues, n === 1 ? "The requested item does not exist" : "None of the requested items exist");
    }

    const now = deps.now();
    const draft: CartRecord = {
      id: deps.newCartId(),
      shopId,
      status: "INCOMPLETE",
      cart: {},
      ...(ctx.clientIdentifier ? { agentClient: ctx.clientIdentifier } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const order = c.validationStatus === "VALID" ? await syncOrder(shopId, draft, input, c, deps) : undefined;
    const record = nextRecord(draft, input, c, deps, order);
    await deps.carts.insert(record);
    return { status: record.status === "CREATED" ? 201 : 200, body: record.cart };
  });
}

/** GET /merchant-cart/{cartId} */
export async function getCart(shopId: string, cartId: string, deps: StoreSyncDeps): Promise<HandlerResult> {
  if (!isWellFormedCartId(cartId)) return invalidCartId(cartId);
  return guarded(deps, { op: "getCart", shopId, cartId }, async () => {
    const record = await deps.carts.get(shopId, cartId);
    return record ? { status: 200, body: record.cart } : cartNotFound(cartId);
  });
}

/** PUT /merchant-cart/{cartId}: full replacement of the cart. */
export async function replaceCart(
  shopId: string,
  cartId: string,
  body: unknown,
  deps: StoreSyncDeps,
): Promise<HandlerResult> {
  if (!isWellFormedCartId(cartId)) return invalidCartId(cartId);
  return serialized(lockKey(shopId, cartId), () =>
    guarded(deps, { op: "replaceCart", shopId, cartId }, async () => {
      const parsed = parseCartRequest(body);
      if (!parsed.ok) return { status: parsed.status, body: parsed.body };
      const record = await deps.carts.get(shopId, cartId);
      if (!record) return cartNotFound(cartId);
      if (record.status === "COMPLETED") {
        return businessError([cartAlreadyCompleted()], "Cart is already completed and can no longer change");
      }

      const input = parsed.cart;
      const c = await price(shopId, cartId, input, record.agentClient, deps);
      const order = c.validationStatus === "VALID" ? await syncOrder(shopId, record, input, c, deps) : undefined;
      const next = nextRecord(record, input, c, deps, order);
      await deps.carts.update(next);
      return { status: 200, body: next.cart };
    }),
  );
}

/**
 * POST /merchant-cart/{cartId}/checkout: called once the buyer has approved
 * the PayPal order. Authorizes the order (funds are captured on shipment) and
 * books the merchant order.
 */
export async function checkoutCart(
  shopId: string,
  cartId: string,
  body: unknown,
  deps: StoreSyncDeps,
): Promise<HandlerResult> {
  if (!isWellFormedCartId(cartId)) return invalidCartId(cartId);
  return serialized(lockKey(shopId, cartId), () =>
    guarded(deps, { op: "checkoutCart", shopId, cartId }, async () => {
      const parsed = parseCartRequest(body, { requireItems: false });
      if (!parsed.ok) return { status: parsed.status, body: parsed.body };
      const record = await deps.carts.get(shopId, cartId);
      if (!record) return cartNotFound(cartId);

      const pm = parsed.cart.payment_method;
      const token = pm?.token?.trim();
      if (!token) {
        return invalidRequest("Payment token is required to complete checkout", [
          {
            field: "payment_method.token",
            issue: "MISSING_REQUIRED_FIELD",
            description: "payment_method.token must carry the approved PayPal order id",
          },
        ]);
      }

      if (record.status === "COMPLETED") {
        if (token === record.paypalOrderId && record.completedResponse) {
          return { status: 200, body: record.completedResponse };
        }
        return declined(token, "TOKEN_DOES_NOT_MATCH_ORDER");
      }

      // A body without items confirms the cart as stored; otherwise it replaces it, as with PUT.
      const input: PayPalCart = parsed.cart.items
        ? parsed.cart
        : {
            ...record.cart,
            payment_method: pm,
            ...(parsed.cart.checkout_fields ? { checkout_fields: parsed.cart.checkout_fields } : {}),
          };
      const c = await price(shopId, cartId, input, record.agentClient, deps);
      if (c.validationStatus !== "VALID") {
        const next = nextRecord(record, input, c, deps);
        await deps.carts.update(next);
        return { status: 200, body: next.cart };
      }
      if (token !== record.paypalOrderId) return declined(token, "TOKEN_DOES_NOT_MATCH_ORDER");

      const order = await syncOrder(shopId, record, input, c, deps);
      const synced = nextRecord(record, input, c, deps, order);
      await deps.carts.update(synced);
      if (order.replaced) {
        return businessError([paymentExpired(token)], "The payment approval has expired");
      }

      const auth = await viaPayPal(() => deps.payments.authorizeOrder(shopId, order.orderId, `${cartId}-authorize`));
      if (auth.status !== "COMPLETED") return declined(token, auth.reason);

      const payerId = auth.payerId || pm?.payer_id || undefined;
      const completedCart = assembleCart(input, c, {
        id: cartId,
        status: "COMPLETED",
        paymentMethod: { type: "paypal", token: order.orderId, ...(payerId ? { payer_id: payerId } : {}) },
      });
      const completing: CartRecord = { ...synced, status: "COMPLETED", cart: completedCart, updatedAt: deps.now() };
      const confirmation = await viaOrderSystem(() =>
        deps.orders.onCompleted(completing, { authorizationId: auth.authorizationId, payerId: auth.payerId }),
      );
      const response = {
        ...completedCart,
        payment_confirmation: {
          merchant_order_number: confirmation.merchantOrderNumber,
          order_review_page: confirmation.orderReviewPage,
        },
      };
      await deps.carts.update({ ...completing, completedResponse: response });
      return { status: 200, body: response };
    }),
  );
}
