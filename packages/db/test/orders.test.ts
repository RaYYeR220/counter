import type { CartRecord } from "@counter/store-sync";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { DbCartRepo, DbOrderSink, events, getOrderByCart, orders, updateOrder, type Db } from "../src/index";
import { SHOP, cartRecord, seededDb } from "./support";

const AUTH = { authorizationId: "0VF52814937998046", payerId: "QYR5Z8XDVJNXQ" };

describe("DbOrderSink", () => {
  let db: Db;
  let sink: DbOrderSink;
  let carts: DbCartRepo;

  async function completedCart(id: string, shopId = SHOP): Promise<CartRecord> {
    const record = cartRecord({
      id,
      shopId,
      status: "CREATED",
      paypalOrderId: `PP-${id}`,
      lastTotalCents: 6800,
      agentClient: "Perplexity",
    });
    await carts.insert(record);
    return { ...record, status: "COMPLETED" };
  }

  beforeEach(async () => {
    db = await seededDb();
    sink = new DbOrderSink(db, { publicBaseUrl: "https://counter.example/" });
    carts = new DbCartRepo(db);
  });

  it("books the cart as an authorized order with a shop-prefixed number", async () => {
    const record = await completedCart("CART-AAAAAAAAAA");
    expect(await sink.onCompleted(record, AUTH)).toEqual({
      merchantOrderNumber: "JC-10001",
      orderReviewPage: "https://counter.example/s/juniper-clay/orders/JC-10001",
    });
    const rows = await db.select().from(orders);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "JC-10001",
      shopId: SHOP,
      cartId: "CART-AAAAAAAAAA",
      paypalOrderId: "PP-CART-AAAAAAAAAA",
      authorizationId: AUTH.authorizationId,
      payerId: AUTH.payerId,
      captureId: null,
      status: "authorized",
      totalCents: 6800,
      platformFeeCents: null,
      tracking: null,
    });
  });

  it("logs an order.authorized event", async () => {
    await sink.onCompleted(await completedCart("CART-AAAAAAAAAA"), AUTH);
    const rows = await db.select().from(events).where(eq(events.type, "order.authorized"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shopId: SHOP,
      ref: "JC-10001",
      payload: {
        cartId: "CART-AAAAAAAAAA",
        paypalOrderId: "PP-CART-AAAAAAAAAA",
        authorizationId: AUTH.authorizationId,
        totalCents: 6800,
        agentClient: "Perplexity",
      },
    });
  });

  it("returns the same order when the same cart completes again", async () => {
    const record = await completedCart("CART-AAAAAAAAAA");
    const first = await sink.onCompleted(record, AUTH);
    const second = await sink.onCompleted(record, AUTH);
    expect(second).toEqual(first);
    expect(await db.$count(orders)).toBe(1);
    expect(await db.$count(events, eq(events.type, "order.authorized"))).toBe(1);
  });

  it("books one order when the same cart completes twice at once", async () => {
    const record = await completedCart("CART-AAAAAAAAAA");
    const [a, b] = await Promise.all([sink.onCompleted(record, AUTH), sink.onCompleted(record, AUTH)]);
    expect(a).toEqual(b);
    expect(await db.$count(orders)).toBe(1);
  });

  it("numbers orders one after another within each shop", async () => {
    const a = await sink.onCompleted(await completedCart("CART-AAAAAAAAA1"), AUTH);
    const b = await sink.onCompleted(await completedCart("CART-AAAAAAAAA2"), AUTH);
    const c = await sink.onCompleted(await completedCart("CART-BBBBBBBBB1", "northpaw-roasters"), AUTH);
    const d = await sink.onCompleted(await completedCart("CART-AAAAAAAAA3"), AUTH);
    expect([a, b, c, d].map((o) => o.merchantOrderNumber)).toEqual(["JC-10001", "JC-10002", "NP-10001", "JC-10003"]);
  });

  it("takes the total from the cart when no PayPal total was recorded", async () => {
    const record = await completedCart("CART-AAAAAAAAAA");
    delete record.lastTotalCents;
    await sink.onCompleted(record, AUTH);
    expect((await getOrderByCart(db, "CART-AAAAAAAAAA"))!.totalCents).toBe(6800);
  });

  it("fails for a shop it does not know", async () => {
    const record = await completedCart("CART-AAAAAAAAAA");
    await expect(sink.onCompleted({ ...record, shopId: "no-such-shop" }, AUTH)).rejects.toThrow();
    expect(await db.$count(orders)).toBe(0);
  });
});

describe("order queries", () => {
  let db: Db;
  beforeEach(async () => {
    db = await seededDb();
    const record = cartRecord({ status: "CREATED", paypalOrderId: "PP-1", lastTotalCents: 6800 });
    await new DbCartRepo(db).insert(record);
    await new DbOrderSink(db).onCompleted({ ...record, status: "COMPLETED" }, AUTH);
  });

  it("finds the order for a cart", async () => {
    expect(await getOrderByCart(db, "CART-AAAAAAAAAA")).toMatchObject({ id: "JC-10001", status: "authorized" });
    expect(await getOrderByCart(db, "CART-ZZZZZZZZZZ")).toBeNull();
  });

  it("updates an order and its timestamp", async () => {
    const before = (await getOrderByCart(db, "CART-AAAAAAAAAA"))!;
    const tracking = { carrier: "USPS", trackingNumber: "9400111899223197428490" };
    const after = await updateOrder(db, "JC-10001", {
      status: "captured",
      captureId: "2GG279541U471931P",
      platformFeeCents: 204,
      tracking,
    });
    expect(after).toMatchObject({ id: "JC-10001", status: "captured", captureId: "2GG279541U471931P", platformFeeCents: 204, tracking });
    expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    expect(await getOrderByCart(db, "CART-AAAAAAAAAA")).toEqual(after);
  });

  it("returns null when updating an unknown order", async () => {
    expect(await updateOrder(db, "JC-99999", { status: "voided" })).toBeNull();
  });
});
