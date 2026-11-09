import type { PayPalCart } from "@counter/store-sync";
import { signStoreSyncJwt, type StoreSyncScope } from "./jwt";

export interface StoreSyncClientOptions {
  /** Base URL of a shop's Store Sync API, e.g. `https://host/s/<shop>/paypal/v1`. */
  baseUrl: (shopSlug: string) => string;
  /** The shop's PayPal merchant id, carried in every token. */
  merchantIdFor: (shopSlug: string) => Promise<string>;
  /** Which agent surface the calls come from (`Client_Identifier` in the token). */
  clientIdentifier: string;
  fetch?: typeof fetch;
  /** PKCS8 PEM. Defaults to `GATEWAY_PRIVATE_KEY_PEM`. */
  privateKeyPem?: string;
  now?: () => Date;
  /** Per-request timeout. Default 15 s. */
  timeoutMs?: number;
}

/** A Store Sync response: the HTTP status and the parsed JSON body (or raw text). */
export interface StoreSyncResponse<T = unknown> {
  status: number;
  body: T;
}

export interface CheckoutParams {
  /** The approved PayPal order id (`payment_method.token`). */
  token: string;
  payerId?: string;
  /** The full cart to confirm. Omit to confirm the cart as the shop stored it. */
  cart?: PayPalCart;
}

/**
 * Calls a shop's Store Sync Cart API the way PayPal's platform does: one
 * freshly signed RS256 token per request, with the `cart` scope (plus
 * `checkout` for checkout) and the shop's merchant id.
 */
export class StoreSyncClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: StoreSyncClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** POST /merchant-cart */
  create(shop: string, cart: PayPalCart): Promise<StoreSyncResponse> {
    return this.call(shop, "POST", "merchant-cart", ["cart"], cart);
  }

  /** GET /merchant-cart/{id} */
  get(shop: string, cartId: string): Promise<StoreSyncResponse> {
    return this.call(shop, "GET", `merchant-cart/${encodeURIComponent(cartId)}`, ["cart"]);
  }

  /** PUT /merchant-cart/{id}: the body replaces the whole cart. */
  replace(shop: string, cartId: string, cart: PayPalCart): Promise<StoreSyncResponse> {
    return this.call(shop, "PUT", `merchant-cart/${encodeURIComponent(cartId)}`, ["cart"], cart);
  }

  /** POST /merchant-cart/{id}/checkout, once the buyer has approved the PayPal order. */
  checkout(shop: string, cartId: string, p: CheckoutParams): Promise<StoreSyncResponse> {
    const body: PayPalCart = {
      ...(p.cart ?? {}),
      payment_method: { type: "paypal", token: p.token, ...(p.payerId ? { payer_id: p.payerId } : {}) },
    };
    return this.call(shop, "POST", `merchant-cart/${encodeURIComponent(cartId)}/checkout`, ["cart", "checkout"], body);
  }

  private async call(
    shop: string,
    method: "GET" | "POST" | "PUT",
    path: string,
    scopes: StoreSyncScope[],
    body?: unknown,
  ): Promise<StoreSyncResponse> {
    const token = await signStoreSyncJwt({
      merchantId: await this.opts.merchantIdFor(shop),
      clientIdentifier: this.opts.clientIdentifier,
      scopes,
      ...(this.opts.privateKeyPem ? { privateKeyPem: this.opts.privateKeyPem } : {}),
      now: this.opts.now?.() ?? new Date(),
    });
    const url = `${this.opts.baseUrl(shop).replace(/\/+$/, "")}/${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON: hand back the text
    }
    return { status: res.status, body: parsed };
  }
}
