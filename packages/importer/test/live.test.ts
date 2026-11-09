import { mkdir, writeFile } from "node:fs/promises";
import { veniceClient } from "@counter/negotiate";
import { afterAll, describe, expect, it } from "vitest";
import { Channel3Mcp } from "../src/channel3/mcp";
import type { C3Product } from "../src/channel3/port";
import { importDrafts } from "../src/pipeline";
import { cleanUrl } from "../src/text";
import type { ProductDraft } from "../src/types";

// Live run against Channel3's MCP server and Venice:
//   IMPORTER_LIVE=1 VENICE_API_KEY=... pnpm --filter @counter/importer test test/live.test.ts
const live = process.env.IMPORTER_LIVE === "1" && Boolean(process.env.VENICE_API_KEY);
const FIXTURES = new URL("./fixtures/", import.meta.url);
/** A small shop's own product page, found by the same search ("Morning mug", Example Ceramics). */
const SHOP_PAGE = "https://pottery-studio.test/products/morning-mug";

/** Every URL without tracking parameters; Channel3 links and images without any query at all. */
function scrub<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => {
      if (typeof v !== "string" || !/^https?:\/\//.test(v)) return v;
      try {
        const u = new URL(cleanUrl(v));
        if (u.hostname.endsWith("trychannel3.com")) u.search = "";
        return u.toString();
      } catch {
        return v;
      }
    }),
  ) as T;
}

function expectSellableShape(d: ProductDraft) {
  expect(d.name.length).toBeGreaterThan(0);
  expect(d.description.length).toBeGreaterThan(0);
  expect(d.variants.length).toBeGreaterThan(0);
  for (const v of d.variants) {
    expect(v.variantId).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
    expect(v.stock).toBe(0);
    expect(v.floorCents).toBeLessThanOrEqual(v.priceCents);
  }
  expect(new Set(d.variants.map((v) => v.variantId)).size).toBe(d.variants.length);
  expect(d.warnings).toContainEqual(expect.stringMatching(/set stock before publishing/i));
}

describe.skipIf(!live)("live: Channel3 MCP + Venice", () => {
  const channel3 = new Channel3Mcp();
  const llm = veniceClient({ apiKey: process.env.VENICE_API_KEY ?? "", timeoutMs: 60_000, retries: 2 });
  const deps = { channel3, llm, policy: { maxDiscountPct: 15 } };
  const recorded: Record<string, unknown> = { recorded_at: new Date().toISOString() };

  afterAll(async () => {
    await channel3.close();
    await mkdir(FIXTURES, { recursive: true });
    await writeFile(new URL("live-from-url.json", FIXTURES), `${JSON.stringify(scrub(recorded), null, 2)}\n`);
  });

  it("imports a product found by search", { timeout: 180_000 }, async () => {
    const results = await channel3.search({ query: "speckled stoneware mug 12 oz" });
    expect(results.length).toBeGreaterThan(0);
    recorded.search = { query: "speckled stoneware mug 12 oz", results: results.map((p) => ({ id: p.id, title: p.title, offers: p.offers })) };

    const pick = results.find((p) => p.offers?.some((o) => o.price.currency === "USD")) as C3Product;
    const link = cleanUrl(pick.offers!.find((o) => o.price.currency === "USD")!.url);
    const [draft] = await importDrafts({ url: link }, deps);
    recorded.from_search_result = { url: link, lookup: await channel3.lookup(link), draft };
    expectSellableShape(draft!);
    expect(draft!.variants[0]!.priceCents).toBeGreaterThan(0);
  });

  it("drafts a product from a photo and prices it against the market", { timeout: 180_000 }, async () => {
    const [mug] = await channel3.search({ query: "speckled stoneware mug" });
    const imageUrl = mug?.images?.[0]?.url;
    expect(imageUrl).toBeTruthy();
    const res = await fetch(imageUrl!);
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!;
    const [draft] = await importDrafts({ photo: { bytes: new Uint8Array(await res.arrayBuffer()), mime, filename: "mug.webp" } }, deps);
    recorded.from_photo = { image: imageUrl, draft };
    expectSellableShape(draft!);
    expect(draft!.name).toMatch(/mug/i);
    expect(draft!.warnings).toContainEqual(expect.stringMatching(/read from a photo/i));
  });

  it("imports a small shop's product page, filling facts from Channel3's catalog", { timeout: 180_000 }, async () => {
    const [draft] = await importDrafts({ url: SHOP_PAGE }, deps);
    recorded.from_shop_page = { url: SHOP_PAGE, lookup: await channel3.lookup(SHOP_PAGE), draft };
    expectSellableShape(draft!);
    expect(draft!.source.ref).toBe(SHOP_PAGE);
  });
});
