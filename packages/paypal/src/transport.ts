import {
  ApiError,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  type ApiResponse,
} from "@paypal/paypal-server-sdk";
import { authAssertion } from "./assertion";
import { LIVE_BASE, type PayPalEnv } from "./env";
import { PayPalApiError } from "./errors";
import { TokenCache } from "./token";

const ASSERTION = "PayPal-Auth-Assertion";
const ATTRIBUTION = "PayPal-Partner-Attribution-Id";

export interface RawRequest {
  headers?: Record<string, string | undefined>;
  /** Serialised as JSON with `Content-Type: application/json`. */
  json?: unknown;
  /** Sent as-is; set the content type in `headers`. */
  body?: BodyInit;
  query?: Record<string, string | number | undefined>;
}

export interface RawResponse<T> {
  status: number;
  data: T;
}

/**
 * Shared plumbing for one platform app: the OAuth token, the per-merchant
 * headers, the Server SDK controllers and plain JSON calls. Every request,
 * SDK or not, goes out through the injected `fetch`.
 */
export class Transport {
  readonly token: TokenCache;
  private controllers?: { orders: OrdersController; payments: PaymentsController };

  constructor(
    readonly env: PayPalEnv,
    private readonly fetchImpl: typeof fetch,
    now?: () => number,
  ) {
    this.token = new TokenCache(env, fetchImpl, now);
  }

  /** The assertion value for acting as `merchantId`, or undefined for first-party calls. */
  assertion(merchantId: string | undefined): string | undefined {
    return merchantId ? authAssertion(this.env.clientId, merchantId) : undefined;
  }

  /** `PayPal-Auth-Assertion` + `PayPal-Partner-Attribution-Id` when acting for a merchant. */
  merchantHeaders(merchantId: string | undefined): Record<string, string> {
    if (!merchantId) return {};
    const h: Record<string, string> = { [ASSERTION]: authAssertion(this.env.clientId, merchantId) };
    if (this.env.bnCode) h[ATTRIBUTION] = this.env.bnCode;
    return h;
  }

  /** Attribution header alone, for partner-level calls (referrals, onboarding status). */
  partnerHeaders(): Record<string, string> {
    return this.env.bnCode ? { [ATTRIBUTION]: this.env.bnCode } : {};
  }

  get orders(): OrdersController {
    return this.sdk().orders;
  }

  get payments(): PaymentsController {
    return this.sdk().payments;
  }

  /** Runs an SDK call and turns SDK errors into PayPalApiError. */
  async sdkCall<T>(context: string, call: () => Promise<ApiResponse<T>>): Promise<ApiResponse<T>> {
    try {
      return await call();
    } catch (e) {
      if (e instanceof ApiError) {
        const text = typeof e.body === "string" ? e.body : "";
        throw PayPalApiError.fromText(e.statusCode, text, context);
      }
      throw e;
    }
  }

  async request<T = unknown>(method: string, path: string, r: RawRequest = {}): Promise<RawResponse<T>> {
    const url = new URL(path, this.env.base);
    for (const [k, v] of Object.entries(r.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const { accessToken } = await this.token.get();
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
    let body = r.body;
    if (r.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(r.json);
    }
    for (const [k, v] of Object.entries(r.headers ?? {})) if (v !== undefined) headers[k] = v;

    const res = await this.fetchImpl(url, { method, headers, body });
    const text = await res.text();
    const context = `${method} ${url.pathname}`;
    if (!res.ok) throw PayPalApiError.fromText(res.status, text, context);
    return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
  }

  private sdk() {
    if (this.controllers) return this.controllers;
    const client = new Client({
      environment: this.env.base === LIVE_BASE ? Environment.Production : Environment.Sandbox,
      timeout: 30_000,
      clientCredentialsAuthCredentials: {
        oAuthClientId: this.env.clientId,
        oAuthClientSecret: this.env.clientSecret,
        // One token cache for SDK and plain calls alike.
        oAuthTokenProvider: async () => {
          const t = await this.token.get();
          return { accessToken: t.accessToken, tokenType: "Bearer", expiry: BigInt(Math.floor(t.expiresAt / 1000)) };
        },
      },
      // Route the SDK's HTTP client through the injected fetch.
      unstable_httpClientOptions: { adapter: "fetch", env: { fetch: this.sdkFetch } },
    });
    this.controllers = { orders: new OrdersController(client), payments: new PaymentsController(client) };
    return this.controllers;
  }

  /**
   * Most SDK operations take an auth assertion but no attribution header; any
   * request acting for a merchant gets the BN code added here.
   */
  private readonly sdkFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    if (this.env.bnCode && req.headers.has(ASSERTION) && !req.headers.has(ATTRIBUTION)) {
      req.headers.set(ATTRIBUTION, this.env.bnCode);
    }
    return this.fetchImpl(req);
  };
}
