import { mkdir, writeFile } from "node:fs/promises";
import { veniceClient } from "@counter/negotiate";
import { afterAll, describe, expect, it } from "vitest";
import { Channel3Mcp } from "../src/channel3/mcp";
import type { C3Product } from "../src/channel3/port";
import { importDrafts } from "../src/pipeline";
import { cleanUrl } from "../src/text";
import type { ProductDraft } from "../src/types";
import { Anonymiser } from "./anonymise";

// Live run against Channel3's MCP server and Venice:
//   IMPORTER_LIVE=1 VENICE_API_KEY=... pnpm --filter @counter/importer test test/live.test.ts
// The recorded output is anonymised before it is written: no merchant,
// brand, product title, Channel3 id or image survives in the fixture.
const live = process.env.IMPORTER_LIVE === "1" && Boolean(process.env.VENICE_API_KEY);
const FIXTURES = new URL("./fixtures/", import.meta.url);
const SEARCH = "speckled stoneware mug 12 oz";
const SMALL_SHOP_SEARCH = "handmade speckled stoneware mug";

function sameTitle(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * A retailer's own product page for one of the search results. Channel3's
 * offer links go through its redirect, so this tries the common store layout
 * `https://<retailer>/products/<title-handle>` and keeps the first page
 * Channel3 resolves to the same product.
 */
async function findShopPage(channel3: Channel3Mcp, results: C3Product[]): Promise<string | undefined> {
  let tries = 0;
  for (const p of results) {
    const handle = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    for (const domain of new Set((p.offers ?? []).map((o) => o.domain))) {
      if (tries++ >= 6) return undefined;
      const url = `https://${domain}/products/${handle}`;
      const found = await channel3.lookup(url).catch(() => null);
      if (found && sameTitle(found.title, p.title)) return url;
    }
  }
  return undefined;
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
  const anon = new Anonymiser();
  /** Sections of the fixture, built after every test has taught `anon` the names to scrub. */
  const sections: Array<() => [string, unknown]> = [];

  afterAll(async () => {
    await channel3.close();
    const recorded = Object.fromEntries([["recorded_at", new Date().toISOString()], ...sections.map((s) => s())]);
    anon.assertClean(recorded);
    await mkdir(FIXTURES, { recursive: true });
    await writeFile(new URL("live-from-url.json", FIXTURES), `${JSON.stringify(recorded, null, 2)}\n`);
  });

  it("imports a product found by search", { timeout: 180_000 }, async () => {
    const results = await channel3.search({ query: SEARCH });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((p) => anon.learn(p));

    const pick = results.find((p) => p.offers?.some((o) => o.price.currency === "USD")) as C3Product;
    const link = cleanUrl(pick.offers!.find((o) => o.price.currency === "USD")!.url);
    const [draft] = await importDrafts({ url: link }, deps);
    const lookup = await channel3.lookup(link);
    anon.learn(lookup);
    anon.title(draft!.name);
    draft!.market?.comparable.forEach((c) => anon.title(c.title));
    sections.push(() => ["search", { query: SEARCH, results: anon.skeleton(results) }]);
    sections.push(() => ["from_search_result", { url: anon.url(link), lookup: anon.skeleton(lookup), draft: anon.draft(draft!) }]);
    expectSellableShape(draft!);
    expect(draft!.variants[0]!.priceCents).toBeGreaterThan(0);
  });

  it("drafts a product from a photo and prices it against the market", { timeout: 180_000 }, async () => {
    const [mug] = await channel3.search({ query: "speckled stoneware mug" });
    anon.learn(mug);
    const imageUrl = mug?.images?.[0]?.url;
    expect(imageUrl).toBeTruthy();
    const res = await fetch(imageUrl!);
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!;
    const [draft] = await importDrafts({ photo: { bytes: new Uint8Array(await res.arrayBuffer()), mime, filename: "mug.webp" } }, deps);
    draft!.market?.comparable.forEach((c) => anon.title(c.title));
    sections.push(() => ["from_photo", { image: anon.url(imageUrl!), draft: anon.draft(draft!) }]);
    expectSellableShape(draft!);
    expect(draft!.name).toMatch(/mug/i);
    expect(draft!.warnings).toContainEqual(expect.stringMatching(/read from a photo/i));
  });

  it("imports a small shop's own product page, filling facts from Channel3's catalog", { timeout: 240_000 }, async (ctx) => {
    const results = await channel3.search({ query: SMALL_SHOP_SEARCH });
    results.forEach((p) => anon.learn(p));
    const page = await findShopPage(channel3, results);
    if (!page) return ctx.skip();

    const [draft] = await importDrafts({ url: page }, deps);
    const lookup = await channel3.lookup(page);
    anon.learn(lookup);
    anon.title(draft!.name);
    draft!.market?.comparable.forEach((c) => anon.title(c.title));
    sections.push(() => ["from_shop_page", { url: anon.url(page), lookup: anon.skeleton(lookup), draft: anon.draft(draft!) }]);
    expectSellableShape(draft!);
    expect(draft!.source.ref).toBe(page);
  });
});
