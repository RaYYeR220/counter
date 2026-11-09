import { describe, expect, it } from "vitest";
import { carts, createTestDb, disputes, events, negotiations, orders, shops, variants } from "../src/index";

describe("createTestDb", () => {
  it("starts empty with every table migrated", async () => {
    const db = await createTestDb();
    for (const table of [shops, variants, carts, orders, events, negotiations, disputes]) {
      expect(await db.select().from(table)).toEqual([]);
    }
  });
});
