import type { Breakdown, OrderItem, OrderShipping, OrderView, PayPalEnv } from "./env";
import {
  authorizeOrder,
  createAuthorizeOrder,
  getOrder,
  patchOrder,
  type AuthorizeResult,
  type CreateAuthorizeOrderParams,
} from "./orders";
import { Transport } from "./transport";

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
}
