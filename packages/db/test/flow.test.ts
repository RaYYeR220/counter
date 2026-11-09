import { checkoutCart, createCart, getCart, replaceCart, toCents, type PayPalCart } from "@counter/store-sync";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ConcurrentUpdateError, DbCartRepo, carts, events, orders, withCartRetry, type Db } from "../src/index";
import { BASE_URL, NOW, SHOP, cartBody, makeDeps, seededDb, type DbDeps } from "./support";

type Cart = PayPalCart & { payment_confirmation?: { merchant_order_number: string; order_review_page: string } };

const MUGS = (n: number) => cartBody([["JC-MUG-SPECKLE", "JC-MUG-SPECKLE-SAGE-12", n]]);

function checkoutBody(token: string): PayPalCart {
  return { payment_method: { type: "paypal", token, payer_id: "QYR5Z8XDVJNXQ" } };
}

describe("Store Sync on the database", () => {
  let db: Db;
  let deps: DbDeps;
  beforeEach(async () => {
    db = await seededDb();
    deps = makeDeps(db);
  });

  async function create(): Promise<Cart> {
    const res = await createCart(SHOP, MUGS(2), deps, { clientIdentifier: "Perplexity" });
    expect(res.status).toBe(201);
    return res.body as Cart;
  }

  it("creates, approves and checks out a cart into one authorized order", async () => {
    const cart = await create();
    const token = cart.payment_method!.token!;
    expect(cart.items![0]).toMatchObject({
      variant_id: "JC-MUG-SPECKLE-SAGE-12",
      name: "Speckled mug — sage, 12 oz",
      price: { currency_code: "USD", value: "34.00" },
    });

    // Checkout before the buyer approves is declined and books nothing.
    expect((await checkoutCart(SHOP, cart.id!, checkoutBody(token), deps)).status).toBe(422);
    expect(await db.$count(orders)).toBe(0);

    deps.payments.approve(token);
    const res = await checkoutCart(SHOP, cart.id!, checkoutBody(token), deps);
    expect(res.status).toBe(200);
    const body = res.body as Cart;
    expect(body.status).toBe("COMPLETED");
    expect(body.payment_confirmation).toEqual({
      merchant_order_number: "JC-10001",
      order_review_page: `${BASE_URL}/s/juniper-clay/orders/JC-10001`,
    });

    const booked = await db.select().from(orders);
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({
      id: "JC-10001",
      shopId: SHOP,
      cartId: cart.id,
      paypalOrderId: token,
      authorizationId: `AUTH-${token}`,
      payerId: "QYR5Z8XDVJNXQ",
      status: "authorized",
      totalCents: toCents(body.totals!.total!.value),
    });
    const logged = await db.select().from(events).where(eq(events.type, "order.authorized"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ shopId: SHOP, ref: "JC-10001", payload: { cartId: cart.id, agentClient: "Perplexity" } });

    const [row] = await db.select().from(carts).where(eq(carts.id, cart.id!));
    expect(row).toMatchObject({ status: "COMPLETED", paypalOrderId: token, agentClient: "Perplexity" });
    expect(row!.completedResponse).toEqual(body);
    expect(deps.errors).toEqual([]);
  });

  it("replays a repeated checkout without booking a second order", async () => {
    const cart = await create();
    const token = cart.payment_method!.token!;
    deps.payments.approve(token);
    const first = await checkoutCart(SHOP, cart.id!, checkoutBody(token), deps);
    const again = await checkoutCart(SHOP, cart.id!, checkoutBody(token), makeDeps(db));
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await db.$count(orders)).toBe(1);
  });

  it("serves the stored cart on GET", async () => {
    const cart = await create();
    const res = await getCart(SHOP, cart.id!, deps);
    expect(res).toEqual({ status: 200, body: cart });
  });
});

describe("withCartRetry", () => {
  let db: Db;
  let deps: DbDeps;
  let cart: Cart;
  beforeEach(async () => {
    db = await seededDb();
    deps = makeDeps(db);
    cart = (await createCart(SHOP, MUGS(1), deps)).body as Cart;
  });

  /** Another instance writes the cart while this request is talking to PayPal. */
  function interfere(times: number) {
    let left = times;
    const arm = () => {
      deps.payments.beforePatch = async () => {
        const other = new DbCartRepo(db);
        const r = (await other.get(SHOP, cart.id!))!;
        await other.update({ ...r, updatedAt: NOW });
        if (--left > 0) arm();
      };
    };
    arm();
  }

  async function quantityStored(): Promise<number> {
    return (await deps.carts.get(SHOP, cart.id!))!.cart.items![0]!.quantity;
  }

  it("lets a lost write surface as a 500 without it", async () => {
    interfere(1);
    const res = await replaceCart(SHOP, cart.id!, MUGS(3), deps);
    expect(res.status).toBe(500);
    expect(deps.errors[0]).toBeInstanceOf(ConcurrentUpdateError);
    expect(await quantityStored()).toBe(1);
  });

  it("re-runs the handler on fresh state after a lost write", async () => {
    interfere(1);
    const res = await withCartRetry(deps, (d) => replaceCart(SHOP, cart.id!, MUGS(3), d));
    expect(res.status).toBe(200);
    expect(await quantityStored()).toBe(3);
    expect(deps.errors).toEqual([]);
  });

  it("gives up after the last attempt and reports the conflict", async () => {
    interfere(10);
    const res = await withCartRetry(deps, (d) => replaceCart(SHOP, cart.id!, MUGS(3), d), { attempts: 2 });
    expect(res.status).toBe(500);
    expect(deps.errors).toHaveLength(1);
    expect(deps.errors[0]).toBeInstanceOf(ConcurrentUpdateError);
  });

  it("passes other failures straight through", async () => {
    deps.payments.beforePatch = async () => {
      throw new Error("PayPal is down");
    };
    const res = await withCartRetry(deps, (d) => replaceCart(SHOP, cart.id!, MUGS(3), d));
    expect(res.status).toBe(500);
    expect(deps.errors).toHaveLength(1);
    expect(deps.errors[0]).not.toBeInstanceOf(ConcurrentUpdateError);
  });
});
