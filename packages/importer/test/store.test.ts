import { listEvents, listVariants, seedCatalog, variants, type Db } from "@counter/db";
import { createTestDb } from "@counter/db/testing";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { publishDrafts, refreshMarket } from "../src/store";
import type { ProductDraft, VariantDraft } from "../src/types";
import { fakeChannel3, offer } from "./fakes";

const SHOP = "juniper-clay";
const BASE = "https://counter.example";
const now = () => new Date("2026-11-09T12:00:00.000Z");

const v = (attributes: Record<string, string>, extra: Partial<VariantDraft> = {}): VariantDraft => ({
  variantId: "",
  attributes,
  priceCents: 4200,
  stock: 3,
  floorCents: 3550,
  flags: [],
  purchasable: true,
  leadTimeDays: 0,
  ...extra,
});

const draft = (extra: Partial<ProductDraft> = {}): ProductDraft => ({
  parentId: "MORNING-MUG",
  name: "Morning mug",
  category: "mugs",
  description: "A ribbed stoneware mug.",
  attributesOrder: ["glaze"],
  variants: [v({ glaze: "sand" }), v({ glaze: "moss" }, { stock: 0 })],
  source: { kind: "url", ref: "https://juniperclay.example/products/morning-mug" },
  warnings: [],
  ...extra,
});

async function row(db: Db, variantId: string) {
  const [r] = await db
    .select()
    .from(variants)
    .where(and(eq(variants.shopId, SHOP), eq(variants.variantId, variantId)));
  return r;
}

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await seedCatalog(db, { publicBaseUrl: BASE });
});

describe("publishDrafts", () => {
  it("inserts variants after the shop's catalog and logs catalog.published", async () => {
    const before = await listVariants(db, SHOP);
    const out = await publishDrafts(db, SHOP, [draft()], { publicBaseUrl: BASE });
    expect(out).toEqual({
      products: 1,
      variants: 2,
      created: 2,
      updated: 0,
      variantIds: ["JC-MORNING-MUG-SAND", "JC-MORNING-MUG-MOSS"],
    });
    const sand = await row(db, "JC-MORNING-MUG-SAND");
    expect(sand).toMatchObject({
      id: "juniper-clay:JC-MORNING-MUG-SAND",
      parentId: "JC-MORNING-MUG",
      name: "Morning mug — sand",
      priceCents: 4200,
      floorCents: 3550,
      stock: 3,
      url: `${BASE}/s/juniper-clay/p/JC-MORNING-MUG?v=JC-MORNING-MUG-SAND`,
      position: Math.max(...before.map((r) => r.position)) + 1,
      active: true,
    });
    const [event] = (await listEvents(db, SHOP)).filter((e) => e.type === "catalog.published");
    expect(event).toMatchObject({
      ref: "JC-MORNING-MUG",
      payload: { products: 1, variants: 2, created: 2, updated: 0, sources: ["url"], variant_ids: ["JC-MORNING-MUG-SAND", "JC-MORNING-MUG-MOSS"] },
    });
  });

  it("updates a product published again, keeping its position and market data", async () => {
    await publishDrafts(db, SHOP, [draft()], { publicBaseUrl: BASE });
    const first = await row(db, "JC-MORNING-MUG-SAND");
    await db
      .update(variants)
      .set({ market: { lowCents: 1 } })
      .where(eq(variants.id, first!.id));

    const again = draft({ variants: [v({ glaze: "sand" }, { priceCents: 4400, floorCents: 3700, stock: 9 }), v({ glaze: "moss" })] });
    const out = await publishDrafts(db, SHOP, [again], { publicBaseUrl: BASE });
    expect(out).toMatchObject({ created: 0, updated: 2 });
    expect(await row(db, "JC-MORNING-MUG-SAND")).toMatchObject({
      priceCents: 4400,
      floorCents: 3700,
      stock: 9,
      position: first!.position,
      market: { lowCents: 1 },
    });
  });

  it("keeps ids unique across drafts with the same parent", async () => {
    const out = await publishDrafts(db, SHOP, [draft(), draft({ name: "Morning mug, seconds" })], { publicBaseUrl: BASE });
    expect(out.variantIds).toEqual(["JC-MORNING-MUG-SAND", "JC-MORNING-MUG-MOSS", "JC-MORNING-MUG-SAND-2", "JC-MORNING-MUG-MOSS-2"]);
  });

  it("refuses drafts that cannot be sold yet and writes nothing", async () => {
    const bad = draft({ variants: [v({ glaze: "sand" }, { priceCents: 0 }), v({ glaze: "moss" }, { floorCents: 9000 })] });
    await expect(publishDrafts(db, SHOP, [bad], { publicBaseUrl: BASE })).rejects.toMatchObject({
      code: "invalid_draft",
      problems: [expect.stringMatching(/sand.*price/i), expect.stringMatching(/moss.*floor/i)],
    });
    expect(await row(db, "JC-MORNING-MUG-MOSS")).toBeUndefined();
  });

  it("refuses an unknown shop", async () => {
    await expect(publishDrafts(db, "nowhere", [draft()])).rejects.toMatchObject({ code: "shop_not_found" });
  });
});

describe("refreshMarket", () => {
  const MARKET = [
    { id: "a", title: "Speckled stoneware mug 12 oz", offers: [offer("one.example", 30)] },
    { id: "b", title: "Speckled mug", offers: [offer("two.example", 36)] },
  ];

  it("checks each product once and stores the result on every variant asked for", async () => {
    const f = fakeChannel3({ search: [{ match: /mug/i, products: MARKET }] });
    const out = await refreshMarket(db, SHOP, ["JC-MUG-SPECKLE-SAGE-12", "JC-MUG-SPECKLE-INK-16", "JC-NOPE"], { channel3: f.c3, now });
    expect(f.searches).toHaveLength(1);
    expect(out).toEqual({ checked: 2, updated: 2, missing: ["JC-NOPE"], noComparables: [] });
    expect((await row(db, "JC-MUG-SPECKLE-SAGE-12"))!.market).toMatchObject({
      lowCents: 3000,
      medianCents: 3300,
      highCents: 3600,
      priceCents: 3400,
      position: "within",
      checkedAt: "2026-11-09T12:00:00.000Z",
    });
    expect((await row(db, "JC-MUG-SPECKLE-INK-16"))!.market).toMatchObject({ priceCents: 3800, position: "above" });
    expect((await row(db, "JC-MUG-SPECKLE-OAT-8"))!.market).toBeNull();
  });

  it("leaves market data alone when nothing comparable is found", async () => {
    const f = fakeChannel3({});
    const out = await refreshMarket(db, SHOP, ["JC-MUG-SPECKLE-SAGE-12"], { channel3: f.c3, now });
    expect(out).toEqual({ checked: 1, updated: 0, missing: [], noComparables: ["JC-MUG-SPECKLE-SAGE-12"] });
  });
});
