import type { PayPalEnv } from "./env";
import { createAuthorizeOrder, type CreateAuthorizeOrderParams } from "./orders";
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
}
