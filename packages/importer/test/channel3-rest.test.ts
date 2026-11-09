import { describe, expect, it } from "vitest";
import { Channel3Rest } from "../src/channel3/rest";
import { Channel3Error } from "../src/channel3/port";

function headersOf(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: headersOf(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = queue.shift();
    if (!next) throw new Error("no more fake responses");
    return next;
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const MUG = { id: "p1", title: "Speckled mug", offers: [{ url: "https://buy.example/p1", domain: "shop.example", price: { price: 34, currency: "USD" } }] };

function client(responses: Response[], now = () => 0) {
  const f = fakeFetch(responses);
  const slept: number[] = [];
  const c3 = new Channel3Rest({
    apiKey: "c3-key",
    fetch: f.fn,
    now,
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { c3, calls: f.calls, slept };
}

describe("Channel3Rest", () => {
  it("searches with the API key and a capped limit", async () => {
    const { c3, calls } = client([json(200, { products: [MUG], next_page_token: null })]);
    expect(await c3.search({ query: "speckled mug", limit: 50 })).toEqual([MUG]);
    expect(calls[0]).toMatchObject({
      url: "https://api.trychannel3.com/v1/search",
      method: "POST",
      body: { query: "speckled mug", limit: 30 },
    });
    expect(calls[0]!.headers["x-api-key"]).toBe("c3-key");
  });

  it("searches by an uploaded image", async () => {
    const { c3, calls } = client([json(200, { products: [] })]);
    expect(c3.imageSearch).toBe(true);
    await c3.search({ imageBase64: "AAAA", query: "mug" });
    expect(calls[0]!.body).toEqual({ query: "mug", base64_image: "AAAA", limit: 10 });
  });

  it("looks up a product page once per hour per URL", async () => {
    let t = 0;
    const { c3, calls } = client(
      [json(200, { product: MUG }), json(200, { product: { ...MUG, title: "later" } })],
      () => t,
    );
    expect(await c3.lookup("https://shop.example/mug?utm_source=x")).toEqual(MUG);
    expect(await c3.lookup("https://shop.example/mug")).toEqual(MUG);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://api.trychannel3.com/v1/lookup", body: { url: "https://shop.example/mug" } });
    t = 60 * 60 * 1000 + 1;
    expect((await c3.lookup("https://shop.example/mug"))?.title).toBe("later");
  });

  it("reads a 404 lookup as not found", async () => {
    const { c3 } = client([json(404, { detail: "Product not found" })]);
    expect(await c3.lookup("https://shop.example/nothing")).toBeNull();
  });

  it("reports a page that is not a product page", async () => {
    const { c3 } = client([json(422, { detail: "Not a product page" })]);
    await expect(c3.lookup("https://shop.example/about")).rejects.toMatchObject({ code: "not_a_product_page", status: 422 });
  });

  it("waits out a 429 and tries again", async () => {
    const { c3, calls, slept } = client([json(429, { detail: "slow down" }, { "retry-after": "5" }), json(200, { products: [MUG] })]);
    expect(await c3.search({ query: "mug" })).toEqual([MUG]);
    expect(calls).toHaveLength(2);
    expect(slept).toContain(5000);
  });

  it("gives up on 429 after its retries", async () => {
    const { c3 } = client([1, 2, 3].map(() => json(429, { detail: "slow down" }, { "retry-after": "1" })));
    await expect(c3.search({ query: "mug" })).rejects.toBeInstanceOf(Channel3Error);
  });

  it("reports running out of credits", async () => {
    const { c3 } = client([json(402, { detail: "Out of credits" })]);
    await expect(c3.search({ query: "mug" })).rejects.toMatchObject({ code: "out_of_credits" });
  });

  it("fetches products by id", async () => {
    const { c3, calls } = client([json(200, MUG), json(404, { detail: "nope" })]);
    expect(await c3.products(["p1", "gone"])).toEqual([MUG]);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["GET", "https://api.trychannel3.com/v1/products/p1"],
      ["GET", "https://api.trychannel3.com/v1/products/gone"],
    ]);
  });
});
