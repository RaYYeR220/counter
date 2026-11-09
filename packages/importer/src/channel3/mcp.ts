import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { cleanUrl } from "../text";
import { RateGate, realSleep, TtlCache, type Clock, type Sleep } from "./limits";
import { Channel3Error, type C3Product, type C3SearchRequest, type Channel3 } from "./port";

export const CHANNEL3_MCP_URL = "https://mcp.trychannel3.com/";
const HOUR = 60 * 60 * 1000;
/** `get_products` takes at most this many ids or URLs per call. */
const MAX_IDS = 40;
const RATE_LIMITED = /rate.?limit|too many requests|\b429\b|quota/i;

export interface McpToolResult {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** The slice of an MCP client the adapter uses. */
export interface McpCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface Channel3McpOptions {
  url?: string;
  /** Optional; the server works without one on its free tier. */
  apiKey?: string;
  /** Replaces the streamable HTTP connection, for tests. */
  connect?: () => Promise<McpCaller>;
  /** Minimum gap between call starts. Default 250 ms. */
  minIntervalMs?: number;
  /** Per tool call. Default 60 s. */
  callTimeoutMs?: number;
  /** Extra attempts after the server reports a rate limit. Default 2. */
  retries?: number;
  now?: Clock;
  sleep?: Sleep;
}

/** Connects to Channel3's MCP server over streamable HTTP. */
export async function connectChannel3Mcp(url: string, apiKey: string | undefined, timeoutMs: number): Promise<McpCaller> {
  const client = new Client({ name: "counter-importer", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    ...(apiKey ? { requestInit: { headers: { "X-API-Key": apiKey } } } : {}),
  });
  await client.connect(transport);
  return {
    async callTool(name, args) {
      return (await client.callTool({ name, arguments: args }, { timeout: timeoutMs })) as McpToolResult;
    },
    close: () => client.close(),
  };
}

function textOf(r: McpToolResult): string {
  return (r.content ?? []).map((c) => c.text ?? "").join("\n").trim();
}

/**
 * Channel3 through its public MCP server (`search_products`, `get_products`),
 * which needs no API key. Every result carries a `thread_id` that the next
 * call passes back. Calls are spaced out, rate-limit errors are retried, and
 * URL lookups are cached for an hour. The server has no image upload, so
 * `imageSearch` is false.
 */
export class Channel3Mcp implements Channel3 {
  readonly kind = "mcp" as const;
  readonly imageSearch = false;
  private connection: Promise<McpCaller> | undefined;
  private threadId: string | undefined;
  private readonly gate: RateGate;
  private readonly sleep: Sleep;
  private readonly lookups: TtlCache<C3Product | null>;

  constructor(private readonly opts: Channel3McpOptions = {}) {
    const now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
    this.gate = new RateGate(opts.minIntervalMs ?? 250, now, this.sleep);
    this.lookups = new TtlCache(HOUR, now, (p) => p !== null);
  }

  async search(req: C3SearchRequest): Promise<C3Product[]> {
    if (!req.query) return [];
    const out = await this.call("search_products", { query: req.query });
    return (out.products ?? []).slice(0, req.limit ?? 8);
  }

  lookup(url: string): Promise<C3Product | null> {
    const clean = cleanUrl(url);
    return this.lookups.get(clean, async () => {
      const out = await this.call("get_products", { product_ids: [clean] });
      if (out.unresolved?.includes(clean)) return null;
      return out.products?.[0] ?? null;
    });
  }

  async products(ids: string[]): Promise<C3Product[]> {
    const found: C3Product[] = [];
    for (let i = 0; i < ids.length; i += MAX_IDS) {
      const out = await this.call("get_products", { product_ids: ids.slice(i, i + MAX_IDS) });
      found.push(...(out.products ?? []));
    }
    return found;
  }

  async close(): Promise<void> {
    const c = this.connection;
    this.connection = undefined;
    if (c) await (await c).close().catch(() => undefined);
  }

  private connect(): Promise<McpCaller> {
    this.connection ??= (
      this.opts.connect ?? (() => connectChannel3Mcp(this.opts.url ?? CHANNEL3_MCP_URL, this.opts.apiKey, this.opts.callTimeoutMs ?? 60_000))
    )().catch((err: unknown) => {
      this.connection = undefined;
      throw new Channel3Error(`Could not reach the Channel3 MCP server: ${String(err)}`, "unavailable");
    });
    return this.connection;
  }

  private async call(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ products?: C3Product[]; unresolved?: string[]; thread_id?: string }> {
    const retries = this.opts.retries ?? 2;
    let reconnected = false;
    for (let attempt = 0; ; attempt++) {
      const withThread = this.threadId ? { ...args, thread_id: this.threadId } : args;
      let result: McpToolResult;
      try {
        const conn = await this.connect();
        result = await this.gate.run(() => conn.callTool(tool, withThread));
      } catch (err) {
        if (err instanceof Channel3Error) throw err;
        // A dropped session: start a new one once.
        await this.close();
        if (reconnected) throw new Channel3Error(`Channel3 ${tool} failed: ${String(err)}`, "unavailable");
        reconnected = true;
        continue;
      }
      if (result.isError) {
        const text = textOf(result);
        if (RATE_LIMITED.test(text)) {
          if (attempt < retries) {
            await this.sleep(5000);
            continue;
          }
          throw new Channel3Error(`Channel3 ${tool} is rate limited: ${text.slice(0, 300)}`, "rate_limited", 429);
        }
        throw new Channel3Error(`Channel3 ${tool} failed: ${text.slice(0, 300)}`, "bad_request");
      }
      const out = (result.structuredContent ?? {}) as { products?: C3Product[]; unresolved?: string[]; thread_id?: string };
      if (typeof out.thread_id === "string") this.threadId = out.thread_id;
      return out;
    }
  }
}
