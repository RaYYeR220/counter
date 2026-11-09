import { beforeAll, describe, expect, it } from "vitest";
import type { PayPalCart } from "@counter/store-sync";
import { StoreSyncClient, generateGatewayKeyPair, type GatewayKeyPair } from "../src/index";
import { AUSTIN, BUYER, MERCHANTS, NOW, PAYER_ID, SHOP_BASE, makeShop, storeSyncFetch, type Shop } from "./harness";

const SHOP = "juniper-clay";
const SAGE_12 = "JC-MUG-SPECKLE-SAGE-12";

let keys: GatewayKeyPair;
beforeAll(async () => {
  keys = await generateGatewayKeyPair();
});

type Cart = PayPalCart & { payment_confirmation?: { merchant_order_number: string; order_review_page: string } };

function setup(over: { merchantIdFor?: (shop: string) => Promise<string>; clock?: () => Date } = {}) {
  const shop: Shop = makeShop();
  const http = storeSyncFetch(shop, keys.publicKeyPem);
  const client = new StoreSyncClient({
    baseUrl: (slug) => `${SHOP_BASE}/s/${slug}/paypal/v1/`,
    merchantIdFor: over.merchantIdFor ?? (async (slug) => MERCHANTS[slug]!),
    clientIdentifier: "Counter",
    fetch: http.fetch,
    privateKeyPem: keys.privateKeyPem,
    now: over.clock ?? (() => NOW),
  });
  return { shop, client, seen: http.seen };
}

function newCart(quantity = 1): PayPalCart {
  return {
    items: [{ variant_id: SAGE_12, quantity }],
    customer: BUYER,
    shipping_address: AUSTIN,
    payment_method: { type: "paypal" },
  };
}

describe("StoreSyncClient", () => {
  it("creates a cart with a cart-scoped token for the shop's merchant", async () => {
    const { client, seen } = setup();
    const res = await client.create(SHOP, newCart());
    expect(res.status).toBe(201);
    const cart = res.body as Cart;
    expect(cart.id).toMatch(/^CART-/);
    expect(cart.totals?.subtotal?.value).toBe("34.00");

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "POST",
      path: `/s/${SHOP}/paypal/v1/merchant-cart`,
      scope: ["cart"],
      externalId: [`PayPal:${MERCHANTS[SHOP]}`, "Client_Identifier:Counter"],
      contentType: "application/json",
    });
  });

  it("reads a cart back", async () => {
    const { client } = setup();
    const created = (await client.create(SHOP, newCart())).body as Cart;
    const res = await client.get(SHOP, created.id!);
    expect(res.status).toBe(200);
    expect((res.body as Cart).id).toBe(created.id);
  });

  it("create, replace with a new quantity, then check out after the buyer approves", async () => {
    const { client, shop, seen } = setup();
    const created = (await client.create(SHOP, newCart(1))).body as Cart;
    const token = created.payment_method!.token!;

    const replaced = await client.replace(SHOP, created.id!, {
      ...newCart(2),
      payment_method: { type: "paypal", token },
    });
    expect(replaced.status).toBe(200);
    const updated = replaced.body as Cart;
    expect(updated.items?.[0]?.quantity).toBe(2);
    expect(updated.totals?.subtotal?.value).toBe("68.00");
    expect(updated.payment_method?.token).toBe(token);
    expect(shop.paypal.orders.get(token)?.totalCents).toBe(Number(updated.totals!.total.value.replace(".", "")));

    shop.paypal.approve(token);
    const done = await client.checkout(SHOP, created.id!, { token, payerId: PAYER_ID });
    expect(done.status).toBe(200);
    const body = done.body as Cart;
    expect(body.status).toBe("COMPLETED");
    expect(body.payment_confirmation?.merchant_order_number).toMatch(/^ORD-/);
    expect(body.payment_method).toMatchObject({ token, payer_id: PAYER_ID });

    const put = seen.find((r) => r.method === "PUT")!;
    expect(put.path).toBe(`/s/${SHOP}/paypal/v1/merchant-cart/${created.id}`);
    expect(put.scope).toEqual(["cart"]);
    const checkout = seen.at(-1)!;
    expect(checkout.path).toBe(`/s/${SHOP}/paypal/v1/merchant-cart/${created.id}/checkout`);
    expect(checkout.scope).toEqual(["cart", "checkout"]);
    expect(checkout.body).toMatchObject({ payment_method: { type: "paypal", token, payer_id: PAYER_ID } });
  });

  it("sends the full cart with checkout when one is given", async () => {
    const { client, shop, seen } = setup();
    const created = (await client.create(SHOP, newCart())).body as Cart;
    const token = created.payment_method!.token!;
    shop.paypal.approve(token);
    const res = await client.checkout(SHOP, created.id!, { token, payerId: PAYER_ID, cart: newCart() });
    expect(res.status).toBe(200);
    expect(seen.at(-1)!.body).toMatchObject({
      items: [{ variant_id: SAGE_12, quantity: 1 }],
      shipping_address: AUSTIN,
      payment_method: { type: "paypal", token, payer_id: PAYER_ID },
    });
  });

  it("passes Store Sync errors through as status and body", async () => {
    const { client } = setup();
    const res = await client.get(SHOP, "CART-NOPE000001");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ name: "CART_NOT_FOUND" });
  });

  it("is refused by the shop when the merchant id is wrong", async () => {
    const { client } = setup({ merchantIdFor: async () => "SOMEONEELSE001" });
    const res = await client.create(SHOP, newCart());
    expect(res.status).toBe(401);
  });

  it("signs a fresh token for every call", async () => {
    let t = NOW.getTime();
    const { client, seen } = setup({ clock: () => new Date((t += 5000)) });
    const created = (await client.create(SHOP, newCart())).body as Cart;
    await client.get(SHOP, created.id!);
    expect(seen.map((r) => r.iat)).toEqual([NOW.getTime() / 1000 + 5, NOW.getTime() / 1000 + 10]);
  });

  it("encodes the cart id in the path", async () => {
    const { client, seen } = setup();
    await client.get(SHOP, "CART-A/../B");
    expect(seen[0]!.path).toBe(`/s/${SHOP}/paypal/v1/merchant-cart/CART-A%2F..%2FB`);
  });
});
