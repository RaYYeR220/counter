import { describe, expect, it } from "vitest";
import { Channel3Mcp, type McpCaller, type McpToolResult } from "../src/channel3/mcp";

type Reply = McpToolResult | Error;

function fakeServer(replies: Reply[]) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let connects = 0;
  let closed = 0;
  const queue = [...replies];
  const connect = async (): Promise<McpCaller> => {
    connects++;
    return {
      async callTool(name, args) {
        calls.push({ name, args });
        const next = queue.shift();
        if (!next) throw new Error("no more fake replies");
        if (next instanceof Error) throw next;
        return next;
      },
      async close() {
        closed++;
      },
    };
  };
  return { connect, calls, stats: () => ({ connects, closed }) };
}

const ok = (structuredContent: Record<string, unknown>): McpToolResult => ({
  structuredContent,
  content: [{ type: "text", text: "ok" }],
});

const MUG = { id: "p1", title: "Speckled mug" };

function adapter(replies: Reply[], now = () => 0) {
  const server = fakeServer(replies);
  const slept: number[] = [];
  const c3 = new Channel3Mcp({
    connect: server.connect,
    now,
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { c3, ...server, slept };
}

describe("Channel3Mcp", () => {
  it("searches with search_products and passes the thread id back", async () => {
    const { c3, calls } = adapter([
      ok({ products: [MUG, { id: "p2", title: "b" }], thread_id: "thr_1" }),
      ok({ products: [MUG], thread_id: "thr_2" }),
    ]);
    expect(c3.imageSearch).toBe(false);
    expect(await c3.search({ query: "speckled mug", limit: 1 })).toEqual([MUG]);
    await c3.search({ query: "bowl" });
    expect(calls).toEqual([
      { name: "search_products", args: { query: "speckled mug" } },
      { name: "search_products", args: { query: "bowl", thread_id: "thr_1" } },
    ]);
  });

  it("looks a URL up with get_products and caches it for an hour", async () => {
    let t = 0;
    const { c3, calls } = adapter([ok({ products: [MUG], thread_id: "t" }), ok({ products: [{ ...MUG, title: "new" }] })], () => t);
    expect(await c3.lookup("https://shop.example/mug?gclid=1")).toEqual(MUG);
    expect(await c3.lookup("https://shop.example/mug")).toEqual(MUG);
    expect(calls).toEqual([{ name: "get_products", args: { product_ids: ["https://shop.example/mug"] } }]);
    t = 60 * 60 * 1000 + 1;
    expect((await c3.lookup("https://shop.example/mug"))?.title).toBe("new");
  });

  it("reads an unresolved URL as not found", async () => {
    const { c3 } = adapter([ok({ products: [], unresolved: ["https://shop.example/x"] })]);
    expect(await c3.lookup("https://shop.example/x")).toBeNull();
  });

  it("fetches products by id, at most 40 per call", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `p${i}`);
    const { c3, calls } = adapter([ok({ products: [MUG] }), ok({ products: [MUG] })]);
    expect(await c3.products(ids)).toHaveLength(2);
    expect((calls[0]!.args.product_ids as string[]).length).toBe(40);
    expect((calls[1]!.args.product_ids as string[]).length).toBe(5);
  });

  it("waits and retries when the server says it is rate limited", async () => {
    const { c3, calls, slept } = adapter([
      { isError: true, content: [{ type: "text", text: "Rate limit exceeded, try again later" }] },
      ok({ products: [MUG] }),
    ]);
    expect(await c3.search({ query: "mug" })).toEqual([MUG]);
    expect(calls).toHaveLength(2);
    expect(slept).toContain(5000);
  });

  it("turns other tool errors into Channel3Error", async () => {
    const { c3 } = adapter([{ isError: true, content: [{ type: "text", text: "Invalid input" }] }]);
    await expect(c3.search({ query: "mug" })).rejects.toMatchObject({ name: "Channel3Error", code: "bad_request" });
  });

  it("reconnects once after the connection drops", async () => {
    const { c3, stats } = adapter([new Error("socket hang up"), ok({ products: [MUG] })]);
    expect(await c3.search({ query: "mug" })).toEqual([MUG]);
    expect(stats().connects).toBe(2);
  });

  it("spaces calls out", async () => {
    let t = 1000;
    const server = fakeServer([ok({ products: [] }), ok({ products: [] })]);
    const slept: number[] = [];
    const c3 = new Channel3Mcp({
      connect: server.connect,
      minIntervalMs: 300,
      now: () => t,
      sleep: async (ms) => {
        slept.push(ms);
        t += ms;
      },
    });
    await Promise.all([c3.search({ query: "a" }), c3.search({ query: "b" })]);
    expect(slept).toEqual([300]);
  });
});

describe("channel3FromEnv", () => {
  it("uses the REST API when CHANNEL3_API_KEY is set, the MCP server otherwise", async () => {
    const { channel3FromEnv } = await import("../src/channel3/index");
    expect(channel3FromEnv({ CHANNEL3_API_KEY: "k" }).kind).toBe("rest");
    expect(channel3FromEnv({ CHANNEL3_API_KEY: " " }).kind).toBe("mcp");
    expect(channel3FromEnv({}).kind).toBe("mcp");
  });
});
