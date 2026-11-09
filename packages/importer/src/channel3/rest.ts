import { cleanUrl } from "../text";
import { RateGate, realSleep, TtlCache, type Clock, type Sleep } from "./limits";
import { Channel3Error, type C3Product, type C3SearchRequest, type Channel3 } from "./port";

export const CHANNEL3_API_BASE = "https://api.trychannel3.com";
const HOUR = 60 * 60 * 1000;

export interface Channel3RestOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per request; lookups fetch the page live and can take 10 s. Default 30 s. */
  timeoutMs?: number;
  /** Extra attempts after a 429 or 502/503. Default 2. */
  retries?: number;
  now?: Clock;
  sleep?: Sleep;
}

/**
 * Channel3's REST API (`x-api-key`). Calls are spaced to the default key
 * limits (search 10/s, lookup 5/s), a 429 is retried after its
 * `Retry-After`, and lookups are cached per URL for an hour.
 */
export class Channel3Rest implements Channel3 {
  readonly kind = "rest" as const;
  readonly imageSearch = true;
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly sleep: Sleep;
  private readonly searchGate: RateGate;
  private readonly lookupGate: RateGate;
  private readonly lookups: TtlCache<C3Product | null>;

  constructor(private readonly opts: Channel3RestOptions) {
    const now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
    this.base = (opts.baseUrl ?? CHANNEL3_API_BASE).replace(/\/+$/, "");
    this.doFetch = opts.fetch ?? fetch;
    this.searchGate = new RateGate(100, now, this.sleep);
    this.lookupGate = new RateGate(200, now, this.sleep);
    this.lookups = new TtlCache(HOUR, now, (p) => p !== null);
  }

  async search(req: C3SearchRequest): Promise<C3Product[]> {
    const body = {
      ...(req.query ? { query: req.query } : {}),
      ...(req.imageBase64 ? { base64_image: req.imageBase64 } : {}),
      limit: Math.min(Math.max(req.limit ?? 10, 1), 30),
    };
    const res = await this.searchGate.run(() => this.request("POST", "/v1/search", body));
    const data = res as { products?: C3Product[]; data?: C3Product[] } | null;
    return data?.products ?? data?.data ?? [];
  }

  lookup(url: string): Promise<C3Product | null> {
    const clean = cleanUrl(url);
    return this.lookups.get(clean, async () => {
      const res = await this.lookupGate.run(() => this.request("POST", "/v1/lookup", { url: clean }));
      return (res as { product?: C3Product } | null)?.product ?? null;
    });
  }

  async products(ids: string[]): Promise<C3Product[]> {
    const out: C3Product[] = [];
    for (const id of ids) {
      const p = await this.searchGate.run(() => this.request("GET", `/v1/products/${encodeURIComponent(id)}`));
      if (p) out.push(p as C3Product);
    }
    return out;
  }

  /** The parsed JSON body, or null for a 404. */
  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const retries = this.opts.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
      let res: Response;
      try {
        res = await this.doFetch(`${this.base}${path}`, {
          method,
          headers: {
            "x-api-key": this.opts.apiKey,
            accept: "application/json",
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: ctrl.signal,
        });
      } catch (err) {
        throw new Channel3Error(`Channel3 did not answer: ${String(err)}`, "unavailable");
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) return res.json();
      if (res.status === 404) return null;
      const retryable = res.status === 429 || res.status === 502 || res.status === 503;
      if (retryable && attempt < retries) {
        const after = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      const detail = await res
        .json()
        .then((d: { detail?: unknown }) => (typeof d?.detail === "string" ? d.detail : JSON.stringify(d?.detail ?? d)))
        .catch(() => res.statusText);
      throw new Channel3Error(`Channel3 ${method} ${path} failed with ${res.status}: ${detail}`, codeFor(res.status), res.status);
    }
  }
}

function codeFor(status: number) {
  if (status === 422) return "not_a_product_page" as const;
  if (status === 429) return "rate_limited" as const;
  if (status === 402) return "out_of_credits" as const;
  if (status === 401 || status === 403) return "unauthorized" as const;
  if (status >= 400 && status < 500) return "bad_request" as const;
  return "unavailable" as const;
}
