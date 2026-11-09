import { describe, expect, it } from "vitest";
import { seedCatalog } from "@counter/db";
import { createTestDb } from "@counter/db/testing";
import { DbShopDirectory } from "../src/directory";

describe("DbShopDirectory", () => {
  it("serves the seeded catalog to agents, flags included, floors and costs excluded", async () => {
    const db = await createTestDb();
    await seedCatalog(db);
    const dir = new DbShopDirectory(db, { now: () => new Date("2026-11-10T15:00:00Z") });
    const shops = await dir.listShops();
    expect(shops.map((s) => s.shop).sort()).toEqual(["juniper-clay", "loop-and-lantern", "northpaw-roasters"]);
    const hits = await dir.search({ query: "green speckled mug 12 oz", shop: "juniper-clay" });
    expect(hits[0]!.variant_id).toBe("JC-MUG-SPECKLE-SAGE-12");
    const product = await dir.getProduct("northpaw-roasters", "NP-CHOICE");
    expect(product!.variants.every((v) => v.purchasable === false)).toBe(true);
    const raw = JSON.stringify(await dir.getProduct("juniper-clay", "JC-MUG-SPECKLE"));
    expect(raw).not.toMatch(/floor|cost/i);
  });
});

describe("test shops", () => {
  it("stay out of discovery but answer when asked for by slug", async () => {
    const { shops } = await import("@counter/db");
    const db = await createTestDb();
    await seedCatalog(db);
    const [jc] = await db.select().from(shops);
    await db.insert(shops).values({ ...jc!, id: "try-abc123", slug: "try-abc123", name: "Test shop", orderPrefix: "TA" });
    const dir = new DbShopDirectory(db, { ttlMs: 0 });
    expect((await dir.listShops()).map((s) => s.shop)).not.toContain("try-abc123");
    expect(await dir.search({ query: "mug", shop: "try-abc123" })).toEqual([]);
  });
});
