import { beforeEach, describe, expect, it } from "vitest";
import { listEvents, logEvent, type Db } from "../src/index";
import { SHOP, seededDb } from "./support";

describe("events", () => {
  let db: Db;
  beforeEach(async () => {
    db = await seededDb();
  });

  async function logMany(n: number, shopId = SHOP) {
    const out = [];
    for (let i = 1; i <= n; i++) out.push(await logEvent(db, shopId, "cart.created", `CART-${i}`, { n: i }));
    return out;
  }

  it("logs an event and returns the stored row", async () => {
    const e = await logEvent(db, SHOP, "cart.created", "CART-AAAAAAAAAA", { agentClient: "Perplexity" });
    expect(e).toMatchObject({ shopId: SHOP, type: "cart.created", ref: "CART-AAAAAAAAAA", payload: { agentClient: "Perplexity" } });
    expect(typeof e.id).toBe("number");
    expect(e.at).toBeInstanceOf(Date);
  });

  it("accepts an event without a ref or payload", async () => {
    const e = await logEvent(db, SHOP, "shop.viewed", null);
    expect(e).toMatchObject({ ref: null, payload: {} });
  });

  it("lists a shop's events oldest first, ignoring other shops", async () => {
    await logMany(3);
    await logEvent(db, "northpaw-roasters", "cart.created", "CART-X", {});
    const list = await listEvents(db, SHOP);
    expect(list.map((e) => e.ref)).toEqual(["CART-1", "CART-2", "CART-3"]);
  });

  it("returns the latest events when limited without a cursor", async () => {
    await logMany(5);
    expect((await listEvents(db, SHOP, { limit: 2 })).map((e) => e.ref)).toEqual(["CART-4", "CART-5"]);
  });

  it("pages forward from a cursor without gaps or repeats", async () => {
    const logged = await logMany(7);
    expect((await listEvents(db, SHOP, { sinceId: logged[1]!.id, limit: 3 })).map((e) => e.ref)).toEqual([
      "CART-3",
      "CART-4",
      "CART-5",
    ]);

    const seen: string[] = [];
    let sinceId = 0;
    for (;;) {
      const page = await listEvents(db, SHOP, { sinceId, limit: 3 });
      if (!page.length) break;
      seen.push(...page.map((e) => e.ref!));
      sinceId = page.at(-1)!.id;
    }
    expect(seen).toEqual(logged.map((e) => e.ref));
  });

  it("returns nothing past the newest event", async () => {
    const logged = await logMany(2);
    expect(await listEvents(db, SHOP, { sinceId: logged[1]!.id })).toEqual([]);
  });
});
