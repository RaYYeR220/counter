import { beforeEach, describe, expect, it } from "vitest";
import { ConcurrentUpdateError, DbCartRepo, type Db, type StoredCartRecord } from "../src/index";
import { NOW, SHOP, cartRecord, seededDb } from "./support";

const LATER = new Date("2026-11-09T15:05:00.000Z");

describe("DbCartRepo", () => {
  let db: Db;
  let repo: DbCartRepo;
  beforeEach(async () => {
    db = await seededDb();
    repo = new DbCartRepo(db);
  });

  it("returns an inserted cart exactly, at version 0", async () => {
    const record = cartRecord();
    await repo.insert(record);
    const got = await repo.get(SHOP, record.id);
    expect(got).toEqual({ ...record, version: 0 });
    expect(got!.createdAt).toEqual(NOW);
    expect(got).not.toHaveProperty("paypalOrderId");
    expect(got).not.toHaveProperty("completedResponse");
  });

  it("keeps optional fields", async () => {
    const record = cartRecord({
      status: "CREATED",
      paypalOrderId: "5O190127TN364715T",
      lastTotalCents: 6800,
      agentClient: "Perplexity",
    });
    await repo.insert(record);
    expect(await repo.get(SHOP, record.id)).toEqual({ ...record, version: 0 });
  });

  it("scopes carts to their shop", async () => {
    await repo.insert(cartRecord());
    expect(await repo.get("northpaw-roasters", "CART-AAAAAAAAAA")).toBeNull();
    expect(await repo.get(SHOP, "CART-ZZZZZZZZZZ")).toBeNull();
  });

  it("refuses a second insert with the same id", async () => {
    await repo.insert(cartRecord());
    await expect(repo.insert(cartRecord())).rejects.toThrow();
  });

  it("round-trips an update and bumps the version", async () => {
    await repo.insert(cartRecord());
    const read = (await repo.get(SHOP, "CART-AAAAAAAAAA"))!;
    const completed = { ...read.cart, status: "COMPLETED" as const };
    const response = { ...completed, payment_confirmation: { merchant_order_number: "JC-10001", order_review_page: "x" } };
    await repo.update({ ...read, status: "COMPLETED", cart: completed, completedResponse: response, updatedAt: LATER });
    expect(await repo.get(SHOP, "CART-AAAAAAAAAA")).toEqual({
      ...read,
      status: "COMPLETED",
      cart: completed,
      completedResponse: response,
      updatedAt: LATER,
      version: 1,
    });
  });

  it("advances the written record's version so the same record can be written again", async () => {
    const record = cartRecord();
    await repo.insert(record);
    expect((record as StoredCartRecord).version).toBe(0);
    const read = (await repo.get(SHOP, record.id))!;
    const next = { ...read, lastTotalCents: 100 };
    await repo.update(next);
    expect(next.version).toBe(1);
    await repo.update({ ...next, lastTotalCents: 200 });
    expect(await repo.get(SHOP, record.id)).toMatchObject({ lastTotalCents: 200, version: 2 });
  });

  it("rejects a write based on a stale read with ConcurrentUpdateError", async () => {
    await repo.insert(cartRecord());
    const mine = (await repo.get(SHOP, "CART-AAAAAAAAAA"))!;
    const theirs = (await new DbCartRepo(db).get(SHOP, "CART-AAAAAAAAAA"))!;
    await repo.update({ ...mine, lastTotalCents: 111 });

    const err = await repo.update({ ...theirs, lastTotalCents: 222 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConcurrentUpdateError);
    expect(err).toMatchObject({ shopId: SHOP, cartId: "CART-AAAAAAAAAA", expectedVersion: 0, actualVersion: 1 });
    expect(await repo.get(SHOP, "CART-AAAAAAAAAA")).toMatchObject({ lastTotalCents: 111, version: 1 });
  });

  it("fails plainly when updating a cart that does not exist", async () => {
    const err = await repo.update({ ...cartRecord(), version: 0 } as StoredCartRecord).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ConcurrentUpdateError);
  });

  it("refuses to update a record that was never read from the store", async () => {
    await repo.insert(cartRecord());
    await expect(repo.update(cartRecord())).rejects.toThrow(TypeError);
  });
});
