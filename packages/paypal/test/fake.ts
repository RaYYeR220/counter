import type { PayPalEnv } from "../src/index";

export const BASE = "https://api-m.sandbox.paypal.com";

export const ENV: PayPalEnv = {
  clientId: "PLATFORM-CLIENT",
  clientSecret: "PLATFORM-SECRET",
  base: BASE,
  bnCode: "COUNTER_SP_PPCP",
  partnerMerchantId: "PARTNERMID001",
};

export interface Seen {
  method: string;
  url: URL;
  /** Path plus query, e.g. `/v2/checkout/orders/ABC`. */
  path: string;
  headers: Headers;
  text: string;
  contentType: string | null;
  json(): any;
  formData(): Promise<FormData>;
}

export type Reply =
  | { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }
  | ((req: Seen) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> });

/**
 * In-memory PayPal: routes are matched by `"METHOD /path"` (query ignored) and
 * answered in order; the last reply for a route repeats. The OAuth endpoint
 * answers with a token by default.
 */
export function fakePayPal(routes: Record<string, Reply | Reply[]> = {}) {
  const seen: Seen[] = [];
  const queues = new Map<string, Reply[]>();
  for (const [k, v] of Object.entries(routes)) queues.set(k, Array.isArray(v) ? [...v] : [v]);
  if (!queues.has("POST /v1/oauth2/token")) {
    queues.set("POST /v1/oauth2/token", [
      { json: { access_token: "A21-token", token_type: "Bearer", expires_in: 32400, scope: "x" } },
    ]);
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const buf = Buffer.from(await req.arrayBuffer());
    const url = new URL(req.url);
    const record: Seen = {
      method: req.method,
      url,
      path: url.pathname + url.search,
      headers: req.headers,
      text: buf.toString("utf8"),
      contentType: req.headers.get("content-type"),
      json() {
        return JSON.parse(this.text);
      },
      formData() {
        return new Response(buf, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
      },
    };
    seen.push(record);
    const key = `${req.method} ${url.pathname}`;
    const queue = queues.get(key);
    if (!queue || queue.length === 0) {
      return new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND", message: `no fake route for ${key}` }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    const r = typeof next === "function" ? next(record) : next;
    const status = r.status ?? 200;
    const body = status === 204 ? null : r.text ?? (r.json === undefined ? "" : JSON.stringify(r.json));
    return new Response(body, {
      status,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    });
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    /** Every request except OAuth token calls. */
    calls: () => seen.filter((s) => s.url.pathname !== "/v1/oauth2/token"),
    tokenCalls: () => seen.filter((s) => s.url.pathname === "/v1/oauth2/token"),
    last: () => {
      const c = seen.filter((s) => s.url.pathname !== "/v1/oauth2/token");
      return c[c.length - 1]!;
    },
  };
}

export const MERCHANT = "SELLERMID0001";

/** The assertion header value for ENV.clientId acting as MERCHANT. */
export function expectedAssertion(merchantId = MERCHANT): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "none" })}.${b({ iss: ENV.clientId, payer_id: merchantId })}.`;
}
