import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import catalog from "../src/seed/catalog.json" with { type: "json" };
import {
  DbCatalog,
  createTestDb,
  getShop,
  listShops,
  listVariants,
  seedCatalog,
  shops,
  variants,
  type Db,
} from "../src/index";

const cents = (v: string) => Math.round(Number(v) * 100);

async function seeded(): Promise<Db> {
  const db = await createTestDb();
  await seedCatalog(db);
  return db;
}

describe("seedCatalog", () => {
  let db: Db;
  beforeAll(async () => {
    db = await seeded();
  });

  it("loads every shop and variant from catalog.json", async () => {
    expect((await db.select().from(shops)).map((s) => s.id).sort()).toEqual([
      "juniper-clay",
      "loop-and-lantern",
      "northpaw-roasters",
    ]);
    expect(await db.$count(variants)).toBe(107);
  });

  it("gives each shop its order prefix and keeps id and slug equal", async () => {
    const rows = await db.select().from(shops);
    expect(Object.fromEntries(rows.map((s) => [s.slug, s.orderPrefix]))).toEqual({
      "juniper-clay": "JC",
      "northpaw-roasters": "NP",
      "loop-and-lantern": "LL",
    });
    for (const s of rows) expect(s.id).toBe(s.slug);
  });

  it("stores money in cents with cost and floor", async () => {
    const [v] = await db.select().from(variants).where(eq(variants.id, "juniper-clay:JC-MUG-SPECKLE-SAGE-12"));
    expect(v).toMatchObject({
      shopId: "juniper-clay",
      variantId: "JC-MUG-SPECKLE-SAGE-12",
      parentId: "JC-MUG-SPECKLE",
      productName: "Speckled mug",
      name: "Speckled mug — sage, 12 oz",
      category: "mugs",
      priceCents: 3400,
      costCents: 1150,
      floorCents: 2900,
      stock: 6,
      weightG: 380,
      flags: [],
      purchasable: true,
      leadTimeDays: 0,
      active: true,
      market: null,
    });
  });

  it("is idempotent and leaves onboarding state alone", async () => {
    const db2 = await seeded();
    await db2.update(shops).set({ paypalMerchantId: "MERCH123", onboardingStatus: "active" }).where(eq(shops.id, "juniper-clay"));
    await db2.update(variants).set({ stock: 0 }).where(eq(variants.id, "juniper-clay:JC-MUG-SPECKLE-SAGE-12"));
    await seedCatalog(db2);
    expect(await db2.$count(shops)).toBe(3);
    expect(await db2.$count(variants)).toBe(107);
    const shop = await getShop(db2, "juniper-clay");
    expect(shop).toMatchObject({ paypalMerchantId: "MERCH123", onboardingStatus: "active" });
    const [v] = await db2.select().from(variants).where(eq(variants.id, "juniper-clay:JC-MUG-SPECKLE-SAGE-12"));
    expect(v!.stock).toBe(6);
  });

  it("builds storefront urls from the public base url", async () => {
    const db2 = await createTestDb();
    await seedCatalog(db2, { publicBaseUrl: "https://counter.example/" });
    const v = await new DbCatalog(db2).getVariant("juniper-clay", "JC-MUG-SPECKLE-SAGE-12");
    expect(v!.url).toBe("https://counter.example/s/juniper-clay/p/JC-MUG-SPECKLE?v=JC-MUG-SPECKLE-SAGE-12");
  });
});

describe("DbCatalog", () => {
  let db: Db;
  let cat: DbCatalog;
  beforeAll(async () => {
    db = await seeded();
    cat = new DbCatalog(db);
  });

  it("returns a variant in cents with stock and attributes", async () => {
    expect(await cat.getVariant("juniper-clay", "JC-MUG-SPECKLE-SAGE-12")).toEqual({
      variantId: "JC-MUG-SPECKLE-SAGE-12",
      parentId: "JC-MUG-SPECKLE",
      name: "Speckled mug — sage, 12 oz",
      url: "http://localhost:3000/s/juniper-clay/p/JC-MUG-SPECKLE?v=JC-MUG-SPECKLE-SAGE-12",
      priceCents: 3400,
      stock: 6,
      attributes: { glaze: "sage", size: "12 oz" },
      active: true,
      leadTimeDays: 0,
      handlingDays: 2,
    });
  });

  it("carries made-to-order lead time and the shop's handling days", async () => {
    for (const glaze of ["SAGE", "INK", "OAT", "RUST"]) {
      const id = `JC-BOWL-SERVING-${glaze}`;
      expect(await cat.getVariant("juniper-clay", id), id).toMatchObject({ leadTimeDays: 21, handlingDays: 2 });
    }
    expect(await cat.getVariant("northpaw-roasters", "NP-GUJI-LIGHT-WB-250")).toMatchObject({
      leadTimeDays: 0,
      handlingDays: 1,
    });
  });

  it("matches catalog.json for every variant", async () => {
    for (const shop of catalog.shops) {
      for (const p of shop.products) {
        for (const v of p.variants) {
          const got = await cat.getVariant(shop.slug, v.variant_id);
          expect(got, v.variant_id).toMatchObject({
            parentId: p.parent_id,
            priceCents: cents(v.price),
            stock: v.stock,
            attributes: v.attributes,
            leadTimeDays: v.lead_time_days,
            handlingDays: shop.policy.handling_days,
          });
        }
      }
    }
  });

  it("returns null for an unknown variant or another shop's variant", async () => {
    expect(await cat.getVariant("juniper-clay", "NOPE-1")).toBeNull();
    expect(await cat.getVariant("juniper-clay", "NP-GUJI-LIGHT-WB-250")).toBeNull();
    expect(await cat.getVariant("no-such-shop", "JC-MUG-SPECKLE-SAGE-12")).toBeNull();
  });

  it("reports a deactivated variant as inactive", async () => {
    const db2 = await seeded();
    await db2.update(variants).set({ active: false }).where(eq(variants.id, "juniper-clay:JC-MUG-SPECKLE-SAGE-12"));
    const v = await new DbCatalog(db2).getVariant("juniper-clay", "JC-MUG-SPECKLE-SAGE-12");
    expect(v).toMatchObject({ variantId: "JC-MUG-SPECKLE-SAGE-12", active: false });
  });

  it("reports subscription-only variants as inactive so carts cannot buy them", async () => {
    for (const id of ["NP-CHOICE-ROT-WB-250", "NP-CHOICE-ROT-DRIP-250"]) {
      expect(await cat.getVariant("northpaw-roasters", id), id).toMatchObject({ variantId: id, active: false });
    }
  });

  it("reports every variant the catalog does not sell on its own as inactive, and no other", async () => {
    for (const shop of catalog.shops) {
      for (const p of shop.products) {
        for (const v of p.variants) {
          const got = await cat.getVariant(shop.slug, v.variant_id);
          expect(got!.active, v.variant_id).toBe(v.active && v.purchasable);
        }
      }
    }
  });
});

describe("shop queries", () => {
  let db: Db;
  beforeAll(async () => {
    db = await seeded();
  });

  it("gets a shop by slug", async () => {
    expect(await getShop(db, "northpaw-roasters")).toMatchObject({
      id: "northpaw-roasters",
      name: "Northpaw Roasters",
      state: "MN",
      jwksMode: "sandbox",
      policy: { negotiation: { enabled: true, max_discount_pct: 10, bundle_min_items: 3 } },
    });
    expect(await getShop(db, "nope")).toBeNull();
  });

  it("lists shops by name", async () => {
    expect((await listShops(db)).map((s) => s.name)).toEqual(["Juniper Clay", "Loop & Lantern", "Northpaw Roasters"]);
  });

  it("lists a shop's variants in catalog order", async () => {
    const rows = await listVariants(db, "juniper-clay");
    const expected = catalog.shops[0]!.products.flatMap((p) => p.variants.map((v) => v.variant_id));
    expect(rows.map((v) => v.variantId)).toEqual(expected);
    expect(await listVariants(db, "nope")).toEqual([]);
  });

  it("lists variants with their raw selling flags", async () => {
    const np = await listVariants(db, "northpaw-roasters");
    expect(np.find((v) => v.variantId === "NP-CHOICE-ROT-WB-250")).toMatchObject({
      active: true,
      purchasable: false,
      flags: ["subscription_only"],
      leadTimeDays: 0,
    });
    const jc = await listVariants(db, "juniper-clay");
    expect(jc.find((v) => v.variantId === "JC-BOWL-SERVING-SAGE")).toMatchObject({
      purchasable: true,
      flags: ["made_to_order"],
      leadTimeDays: 21,
    });
  });
});
