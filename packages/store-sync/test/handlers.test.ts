import { describe, expect, it } from "vitest";
import {
  BusinessErrorSchema,
  ErrorSchema,
  PayPalCartSchema,
  completeCheckoutResponse200Schema,
} from "@paypal/commerce-cart-zod";
import {
  checkoutCart,
  createCart,
  getCart,
  isWellFormedCartId,
  randomCartId,
  replaceCart,
  type AppliedDiscountIn,
  type PayPalCart,
} from "../src/index";
import { BOWL, MUG, NEW_YORK, OOS, OTHER_SHOP, SHOP, SYDNEY, TEE, cartBody, line } from "./fixtures";
import { makeDeps, type TestDeps } from "./harness";

type Cart = PayPalCart & { payment_confirmation?: { merchant_order_number: string; order_review_page: string } };

function strict(body: unknown) {
  const res = PayPalCartSchema.strict().safeParse(body);
  if (!res.success) throw new Error(JSON.stringify(res.error.issues, null, 2));
  return body as Cart;
}

async function created(deps: TestDeps, body: PayPalCart = cartBody()) {
  const res = await createCart(SHOP, body, deps, { clientIdentifier: "Perplexity" });
  expect(res.status).toBe(201);
  return strict(res.body);
}

/** What the platform sends on PUT: the previous cart with changes, including our options and token. */
function putBody(prev: Cart, over: Partial<PayPalCart> = {}): PayPalCart {
  return cartBody({
    id: prev.id,
    items: prev.items!.map((i) => ({ parent_id: i.parent_id, variant_id: i.variant_id, quantity: i.quantity })),
    available_shipping_options: prev.available_shipping_options,
    payment_method: { type: "paypal", token: prev.payment_method?.token ?? null },
    ...over,
  });
}

function checkoutBody(prev: Cart, over: Partial<PayPalCart> = {}): PayPalCart {
  return putBody(prev, {
    payment_method: { type: "paypal", token: prev.payment_method!.token, payer_id: "QYR5Z8XDVJNXQ" },
    ...over,
  });
}

describe("cart ids", () => {
  it("generates CART- plus 10 upper-case alphanumerics", () => {
    for (let i = 0; i < 50; i++) expect(randomCartId()).toMatch(/^CART-[A-Z0-9]{10}$/);
  });

  it("knows a well-formed id from a malformed one", () => {
    expect(isWellFormedCartId("CART-7F3K2Q9XAB")).toBe(true);
    expect(isWellFormedCartId("CART-MISSING-123")).toBe(true);
    for (const bad of ["", "cart-abc", "CART-", "CART-abc", "{{cart_id}}", "CART-ABC/../x", `CART-${"A".repeat(80)}`]) {
      expect(isWellFormedCartId(bad)).toBe(false);
    }
  });
});

describe("createCart", () => {
  it("creates a valid cart with a PayPal order: 201 CREATED", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    expect(cart.id).toBe("CART-T000000001");
    expect(cart.status).toBe("CREATED");
    expect(cart.validation_status).toBe("VALID");
    expect(cart.validation_issues).toEqual([]);
    expect(cart.payment_method).toEqual({
      type: "paypal",
      token: deps.payments.created[0]!.orderId,
      approval_url: `https://www.sandbox.paypal.com/checkoutnow?token=${deps.payments.created[0]!.orderId}`,
    });
    expect(deps.payments.created).toHaveLength(1);
    expect(deps.payments.created[0]!.requestId).toBe("CART-T000000001-create");
  });

  it("hands the payment port authoritative amounts and lines", async () => {
    const deps = makeDeps();
    const cart = await created(deps, cartBody({ items: [line(MUG, 2), line(TEE)] }));
    const pay = deps.payments.created[0]!.cart;
    expect(pay).toMatchObject({
      cartId: cart.id,
      currency: "USD",
      subtotalCents: 6800,
      discountCents: 0,
      shippingCents: 599,
      taxCents: 536,
      totalCents: 7935,
      recipientName: "John Doe",
      shippingOptionId: "STANDARD",
    });
    expect(pay.items).toEqual([
      expect.objectContaining({ variantId: MUG.variantId, quantity: 2, unitCents: 2500, name: MUG.name }),
      expect.objectContaining({ variantId: TEE.variantId, quantity: 1, unitCents: 1800 }),
    ]);
    expect(pay.shippingAddress).toMatchObject({ admin_area_1: "CA", country_code: "US" });
    expect(cart.totals!.total!.value).toBe("79.35");
  });

  it("generates its own id instead of echoing the platform's", async () => {
    const cart = await created(makeDeps());
    expect(cart.id).not.toBe("paypal-cart-id-sent-for-create");
  });

  it("stores the record with the order, total and calling client", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const rec = await deps.carts.get(SHOP, cart.id!);
    expect(rec).toMatchObject({
      id: cart.id,
      shopId: SHOP,
      status: "CREATED",
      paypalOrderId: cart.payment_method!.token,
      lastTotalCents: 3324,
      agentClient: "Perplexity",
    });
    expect(rec!.cart).toEqual(cart);
  });

  it("answers 200 INCOMPLETE without a PayPal order when an item is out of stock", async () => {
    const deps = makeDeps();
    const res = await createCart(SHOP, cartBody({ items: [line(OOS)] }), deps, {});
    expect(res.status).toBe(200);
    const cart = strict(res.body);
    expect(cart.status).toBe("INCOMPLETE");
    expect(cart.validation_status).toBe("INVALID");
    expect(cart).not.toHaveProperty("payment_method");
    expect(deps.payments.created).toHaveLength(0);
    expect(await deps.carts.get(SHOP, cart.id!)).toMatchObject({ status: "INCOMPLETE" });
  });

  it("answers 200 REQUIRES_ADDITIONAL_INFORMATION without an address", async () => {
    const { shipping_address: _drop, ...body } = cartBody();
    const res = await createCart(SHOP, body, makeDeps(), {});
    expect(res.status).toBe(200);
    expect(strict(res.body).validation_status).toBe("REQUIRES_ADDITIONAL_INFORMATION");
  });

  it("answers 200 with issues for a destination it cannot ship to", async () => {
    const res = await createCart(SHOP, cartBody({ shipping_address: SYDNEY }), makeDeps(), {});
    expect(res.status).toBe(200);
    expect(strict(res.body).validation_issues![0]!.context!.specific_issue).toBe("INTERNATIONAL_SHIPPING_RESTRICTED");
  });

  it("keeps every item, known or not, when only some can be bought", async () => {
    const deps = makeDeps();
    const items = [line(MUG), line(OOS), { parent_id: "FAKE_PARENT_ID_99999", variant_id: "FAKE_VARIANT_ID_99999", quantity: 1 }];
    const res = await createCart(SHOP, cartBody({ items }), deps, {});
    expect(res.status).toBe(200);
    const cart = strict(res.body);
    expect(cart.items!.map((i) => i.variant_id)).toEqual([MUG.variantId, OOS.variantId, "FAKE_VARIANT_ID_99999"]);
    expect(cart.validation_issues!.map((i) => i.variant_id)).toEqual([OOS.variantId, "FAKE_VARIANT_ID_99999"]);
    expect(deps.payments.created).toHaveLength(0);
  });

  it("refuses with 422 when no requested item exists", async () => {
    const deps = makeDeps();
    const items = [{ parent_id: "INVALID_PARENT_ID_12345", variant_id: "INVALID_VARIANT_ID_12345", quantity: 1 }];
    const res = await createCart(SHOP, cartBody({ items }), deps, {});
    expect(res.status).toBe(422);
    expect(BusinessErrorSchema.safeParse(res.body).success).toBe(true);
    const body = res.body as {
      name: string;
      message: string;
      business_context: { context: { specific_issue: string } };
      details: Array<{ issue: string; field: string; business_context: { variant_id: string } }>;
    };
    expect(body.name).toBe("UNPROCESSABLE_ENTITY");
    expect(body.business_context.context.specific_issue).toBe("ITEM_NOT_FOUND");
    expect(body.details[0]).toMatchObject({
      issue: "ITEM_NOT_FOUND",
      field: "items[0].variant_id",
      business_context: { variant_id: "INVALID_VARIANT_ID_12345" },
    });
    expect(deps.payments.created).toHaveLength(0);
    expect(deps.carts.size).toBe(0);
  });

  it.each([
    ["zero quantity", { items: [{ ...line(MUG), quantity: 0 }] }],
    ["negative quantity", { items: [{ ...line(MUG), quantity: -2 }] }],
    ["fractional quantity", { items: [{ ...line(MUG), quantity: 1.5 }] }],
    ["empty items", { items: [] }],
  ])("rejects %s with 400 and makes no PayPal call", async (_name, over) => {
    const deps = makeDeps();
    const res = await createCart(SHOP, cartBody(over as Partial<PayPalCart>), deps, {});
    expect(res.status).toBe(400);
    expect(ErrorSchema.safeParse(res.body).success).toBe(true);
    expect((res.body as { name: string }).name).toBe("INVALID_REQUEST");
    expect(deps.payments.created).toHaveLength(0);
    expect(deps.carts.size).toBe(0);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await createCart(SHOP, '{"items": [', makeDeps(), {});
    expect(res.status).toBe(400);
  });

  it("answers 500 with an error body when PayPal is unavailable, and stores nothing", async () => {
    const deps = makeDeps();
    deps.payments.failCreate = new Error("503 from PayPal");
    const res = await createCart(SHOP, cartBody(), deps, {});
    expect(res.status).toBe(500);
    expect(ErrorSchema.safeParse(res.body).success).toBe(true);
    expect(deps.carts.size).toBe(0);
    expect(deps.errors).toHaveLength(1);
  });

  it("applies discounts from the discount port", async () => {
    const offers: AppliedDiscountIn[] = [{ code: "DEAL-1", amountCents: 300, description: "Agreed price" }];
    const seen: unknown[] = [];
    const deps = makeDeps({
      discounts: {
        forCart: async (_shop, q) => {
          seen.push(q);
          return offers;
        },
      },
    });
    const cart = await created(deps);
    expect(cart.totals!.discount!.value).toBe("3.00");
    expect(cart.discounts!.applied![0]!.code).toBe("DEAL-1");
    expect(deps.payments.created[0]!.cart.discountCents).toBe(300);
    expect(seen[0]).toMatchObject({ cartId: undefined, agentClient: "Perplexity" });
  });
});

describe("getCart", () => {
  it("returns the stored cart", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await getCart(SHOP, cart.id!, deps);
    expect(res.status).toBe(200);
    expect(strict(res.body)).toEqual(cart);
  });

  it("answers 400 INVALID_CART_ID for a malformed id", async () => {
    const res = await getCart(SHOP, "not a cart", makeDeps());
    expect(res.status).toBe(400);
    expect((res.body as { name: string }).name).toBe("INVALID_CART_ID");
    expect(ErrorSchema.safeParse(res.body).success).toBe(true);
  });

  it("answers 404 CART_NOT_FOUND for an unknown id", async () => {
    const res = await getCart(SHOP, "CART-MISSING-123", makeDeps());
    expect(res.status).toBe(404);
    expect((res.body as { name: string }).name).toBe("CART_NOT_FOUND");
  });

  it("does not leak carts across shops", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    expect((await getCart(OTHER_SHOP, cart.id!, deps)).status).toBe(404);
  });
});

describe("replaceCart", () => {
  it("replaces the cart and echoes the new address", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await replaceCart(SHOP, cart.id!, putBody(cart, { shipping_address: NEW_YORK }), deps);
    expect(res.status).toBe(200);
    const next = strict(res.body);
    expect(next.shipping_address).toEqual(NEW_YORK);
    expect(next.payment_method!.token).toBe(cart.payment_method!.token);
    expect(next.status).toBe("CREATED");
  });

  it("uses the cart id from the path, not the body", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await replaceCart(SHOP, cart.id!, putBody(cart, { id: "CART-SOMETHINGELSE" }), deps);
    expect(strict(res.body).id).toBe(cart.id);
  });

  it("PATCHes the PayPal order when the total changes, and not otherwise", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const same = await replaceCart(SHOP, cart.id!, putBody(cart), deps);
    expect(same.status).toBe(200);
    expect(deps.payments.patched).toHaveLength(0);

    const res = await replaceCart(SHOP, cart.id!, putBody(cart, { items: [line(MUG, 2)] }), deps);
    const next = strict(res.body);
    expect(deps.payments.patched).toHaveLength(1);
    expect(deps.payments.patched[0]!.orderId).toBe(cart.payment_method!.token);
    expect(deps.payments.patched[0]!.cart.totalCents).toBe(Math.round(Number(next.totals!.total!.value) * 100));
    expect(deps.payments.created).toHaveLength(1);
  });

  it("PATCHes when the address changes even if the total does not", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await replaceCart(SHOP, cart.id!, putBody(cart, { shipping_address: NEW_YORK }), deps);
    expect(strict(res.body).totals!.total).toEqual(cart.totals!.total);
    expect(deps.payments.patched).toHaveLength(1);
  });

  it("honours the selected shipping option", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const flipped = cart.available_shipping_options!.map((o) => ({ ...o, is_selected: o.id === "EXPRESS" }));
    const res = await replaceCart(SHOP, cart.id!, putBody(cart, { available_shipping_options: flipped }), deps);
    const next = strict(res.body);
    expect(next.available_shipping_options!.find((o) => o.is_selected)!.id).toBe("EXPRESS");
    expect(next.totals!.shipping!.value).toBe("14.99");
  });

  it("goes INCOMPLETE without calling PayPal when the new cart has problems", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await replaceCart(SHOP, cart.id!, putBody(cart, { items: [line(OOS)] }), deps);
    expect(res.status).toBe(200);
    const next = strict(res.body);
    expect(next.status).toBe("INCOMPLETE");
    expect(next.payment_method!.token).toBe(cart.payment_method!.token);
    expect(deps.payments.patched).toHaveLength(0);
  });

  it("creates the PayPal order once an incomplete cart becomes valid", async () => {
    const deps = makeDeps();
    const res0 = await createCart(SHOP, cartBody({ items: [line(OOS)] }), deps, {});
    const incomplete = strict(res0.body);
    const res = await replaceCart(SHOP, incomplete.id!, putBody(incomplete, { items: [line(MUG)] }), deps);
    expect(res.status).toBe(200);
    const next = strict(res.body);
    expect(next.status).toBe("CREATED");
    expect(deps.payments.created).toHaveLength(1);
    expect(deps.payments.created[0]!.requestId).toBe(`${incomplete.id}-create`);
    expect(next.payment_method!.token).toBe(deps.payments.created[0]!.orderId);
  });

  it("replaces an expired PayPal order with a fresh one and returns the new token", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const oldToken = cart.payment_method!.token!;
    deps.payments.expired.add(oldToken);
    const res = await replaceCart(SHOP, cart.id!, putBody(cart, { items: [line(MUG, 3)] }), deps);
    expect(res.status).toBe(200);
    const next = strict(res.body);
    expect(deps.payments.created).toHaveLength(2);
    expect(deps.payments.created[1]!.requestId).not.toBe(`${cart.id}-create`);
    const newToken = deps.payments.created[1]!.orderId;
    expect(newToken).not.toBe(oldToken);
    expect(next.payment_method!.token).toBe(newToken);
    expect(next.payment_method!.approval_url).toContain(newToken);
    expect((await deps.carts.get(SHOP, cart.id!))!.paypalOrderId).toBe(newToken);
  });

  it("serialises concurrent retries: one PATCH per distinct total, no duplicate orders", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const body = putBody(cart, { items: [line(MUG, 2)] });
    const results = await Promise.all([1, 2, 3].map(() => replaceCart(SHOP, cart.id!, body, deps)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(deps.payments.patched).toHaveLength(1);
    expect(deps.payments.created).toHaveLength(1);
  });

  it("lets the last of several concurrent writes win", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    await Promise.all([
      replaceCart(SHOP, cart.id!, putBody(cart, { items: [line(MUG, 2)] }), deps),
      replaceCart(SHOP, cart.id!, putBody(cart, { items: [line(BOWL, 1)] }), deps),
    ]);
    const stored = strict((await getCart(SHOP, cart.id!, deps)).body);
    expect(stored.items!.map((i) => i.variant_id)).toEqual([BOWL.variantId]);
    const rec = await deps.carts.get(SHOP, cart.id!);
    expect(rec!.lastTotalCents).toBe(Math.round(Number(stored.totals!.total!.value) * 100));
  });

  it("rejects a zero quantity with 400 and leaves the cart alone", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await replaceCart(SHOP, cart.id!, putBody(cart, { items: [{ ...line(MUG), quantity: 0 }] }), deps);
    expect(res.status).toBe(400);
    expect(deps.payments.patched).toHaveLength(0);
    expect((await deps.carts.get(SHOP, cart.id!))!.cart).toEqual(cart);
  });

  it("answers 404 for an unknown cart and 400 for a malformed id", async () => {
    const deps = makeDeps();
    expect((await replaceCart(SHOP, "CART-NOPE000000", cartBody(), deps)).status).toBe(404);
    expect((await replaceCart(SHOP, "nope", cartBody(), deps)).status).toBe(400);
  });

  it("leaves the stored cart unchanged when the PATCH fails", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    deps.payments.failPatch = new Error("PayPal 500");
    const res = await replaceCart(SHOP, cart.id!, putBody(cart, { items: [line(MUG, 2)] }), deps);
    expect(res.status).toBe(500);
    expect((await deps.carts.get(SHOP, cart.id!))!.cart).toEqual(cart);
  });

  it("refuses to change a completed cart", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    await checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps);
    const res = await replaceCart(SHOP, cart.id!, putBody(cart, { items: [line(MUG, 2)] }), deps);
    expect(res.status).toBe(422);
    expect(BusinessErrorSchema.safeParse(res.body).success).toBe(true);
  });
});

describe("checkoutCart", () => {
  it("authorizes the approved order and completes the cart", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps);
    expect(res.status).toBe(200);
    expect(completeCheckoutResponse200Schema.safeParse(res.body).success).toBe(true);
    const body = res.body as Cart;
    expect(body.status).toBe("COMPLETED");
    expect(body.validation_status).toBe("VALID");
    expect(body.payment_method).toEqual({ type: "paypal", token: cart.payment_method!.token, payer_id: "QYR5Z8XDVJNXQ" });
    expect(body.payment_confirmation).toEqual({
      merchant_order_number: "ORD-10042",
      order_review_page: "https://shop.example/orders/ORD-10042",
    });
    const { payment_confirmation: _pc, ...rest } = body;
    strict(rest);
    expect(deps.payments.authorized).toEqual([
      { shopId: SHOP, orderId: cart.payment_method!.token, requestId: `${cart.id}-authorize` },
    ]);
    expect(deps.orders.completed).toHaveLength(1);
    expect(deps.orders.completed[0]!.auth).toEqual({ authorizationId: "AUTH-1", payerId: "QYR5Z8XDVJNXQ" });
    const rec = await deps.carts.get(SHOP, cart.id!);
    expect(rec!.status).toBe("COMPLETED");
    expect(rec!.completedResponse).toEqual(body);
  });

  it("keeps completed carts readable", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    await checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps);
    const res = await getCart(SHOP, cart.id!, deps);
    expect(res.status).toBe(200);
    expect(strict(res.body).status).toBe("COMPLETED");
  });

  it("replays the stored response for the same token without authorizing again", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const first = await checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps);
    const second = await checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(deps.payments.authorized).toHaveLength(1);
    expect(deps.orders.completed).toHaveLength(1);
  });

  it("authorizes once when the same checkout arrives twice at the same time", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const [a, b] = await Promise.all([
      checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps),
      checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps),
    ]);
    expect(a.body).toEqual(b.body);
    expect(deps.payments.authorized).toHaveLength(1);
  });

  it("declines a different token on a completed cart with 422 PAYMENT_DECLINED", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    await checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps);
    const res = await checkoutCart(
      SHOP,
      cart.id!,
      checkoutBody(cart, { payment_method: { type: "paypal", token: "INVALID_TOKEN_12345", payer_id: "X" } }),
      deps,
    );
    expect(res.status).toBe(422);
    expect(BusinessErrorSchema.safeParse(res.body).success).toBe(true);
    const body = res.body as { details: Array<{ issue: string }>; business_context: { context: { specific_issue: string } } };
    expect(body.details[0]!.issue).toBe("PAYMENT_DECLINED");
    expect(body.business_context.context.specific_issue).toBe("PAYMENT_DECLINED");
    expect(deps.payments.authorized).toHaveLength(1);
  });

  it("declines a token that is not this cart's order without calling PayPal", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await checkoutCart(
      SHOP,
      cart.id!,
      checkoutBody(cart, { payment_method: { type: "paypal", token: "SOMEONE-ELSES", payer_id: "X" } }),
      deps,
    );
    expect(res.status).toBe(422);
    expect(deps.payments.authorized).toHaveLength(0);
    expect((await deps.carts.get(SHOP, cart.id!))!.status).toBe("CREATED");
  });

  it("requires a payment token", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await checkoutCart(SHOP, cart.id!, putBody(cart, { payment_method: { type: "paypal" } }), deps);
    expect(res.status).toBe(400);
    expect((res.body as { details: Array<{ field: string }> }).details[0]!.field).toBe("payment_method.token");
  });

  it("answers 404 for an unknown cart and 400 for a malformed id", async () => {
    const deps = makeDeps();
    const body = cartBody({ payment_method: { type: "paypal", token: "T" } });
    expect((await checkoutCart(SHOP, "CART-NOPE000000", body, deps)).status).toBe(404);
    expect((await checkoutCart(SHOP, "bad id", body, deps)).status).toBe(400);
  });

  it("returns 200 INCOMPLETE with issues and does not authorize when the final cart has problems", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await checkoutCart(SHOP, cart.id!, checkoutBody(cart, { items: [line(OOS)] }), deps);
    expect(res.status).toBe(200);
    const body = strict(res.body);
    expect(body.status).toBe("INCOMPLETE");
    expect(body.validation_issues!.length).toBeGreaterThan(0);
    expect(deps.payments.authorized).toHaveLength(0);
  });

  it("answers 422 PAYMENT_DECLINED when PayPal declines, and the cart stays open", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    deps.payments.authorizeOutcome = { status: "DECLINED", reason: "INSTRUMENT_DECLINED" };
    const res = await checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps);
    expect(res.status).toBe(422);
    expect(BusinessErrorSchema.safeParse(res.body).success).toBe(true);
    const body = res.body as { business_context: { context: { specific_issue: string; decline_reason: string } } };
    expect(body.business_context.context).toMatchObject({
      specific_issue: "PAYMENT_DECLINED",
      decline_reason: "INSTRUMENT_DECLINED",
    });
    expect((await deps.carts.get(SHOP, cart.id!))!.status).toBe("CREATED");
    expect(deps.orders.completed).toHaveLength(0);
  });

  it("syncs a changed total to PayPal before authorizing", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    const res = await checkoutCart(SHOP, cart.id!, checkoutBody(cart, { items: [line(MUG, 2)] }), deps);
    expect(res.status).toBe(200);
    expect(deps.payments.patched).toHaveLength(1);
    expect(deps.payments.patched[0]!.cart.totalCents).toBe(
      Math.round(Number((res.body as Cart).totals!.total!.value) * 100),
    );
  });

  it("answers 422 PAYMENT_EXPIRED with a fresh order when the approved order has expired", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    deps.payments.expired.add(cart.payment_method!.token!);
    const res = await checkoutCart(SHOP, cart.id!, checkoutBody(cart, { items: [line(MUG, 2)] }), deps);
    expect(res.status).toBe(422);
    expect(BusinessErrorSchema.safeParse(res.body).success).toBe(true);
    expect((res.body as { details: Array<{ issue: string }> }).details[0]!.issue).toBe("PAYMENT_EXPIRED");
    expect(deps.payments.authorized).toHaveLength(0);
    const rec = await deps.carts.get(SHOP, cart.id!);
    expect(rec!.paypalOrderId).toBe(deps.payments.created[1]!.orderId);
    expect(rec!.status).toBe("CREATED");
  });

  it("accepts a body that carries only the payment details", async () => {
    const deps = makeDeps();
    const cart = await created(deps, cartBody({ items: [line(MUG), line(TEE)] }));
    const res = await checkoutCart(
      SHOP,
      cart.id!,
      { payment_method: { type: "paypal", token: cart.payment_method!.token, payer_id: "QYR5Z8XDVJNXQ" } },
      deps,
    );
    expect(res.status).toBe(200);
    const body = res.body as Cart;
    expect(body.status).toBe("COMPLETED");
    expect(body.items!.map((i) => i.variant_id)).toEqual([MUG.variantId, TEE.variantId]);
    expect(body.customer).toEqual(cart.customer);
    expect(deps.payments.patched).toHaveLength(0);
  });

  it("answers 500 when authorization fails unexpectedly, and the cart stays open", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    deps.payments.authorizeOutcome = new Error("timeout");
    const res = await checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps);
    expect(res.status).toBe(500);
    expect(ErrorSchema.safeParse(res.body).success).toBe(true);
    expect((await deps.carts.get(SHOP, cart.id!))!.status).toBe("CREATED");
  });

  it("can be retried after the order system failed post-authorization", async () => {
    const deps = makeDeps();
    const cart = await created(deps);
    deps.orders.fail = new Error("db down");
    const failed = await checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps);
    expect(failed.status).toBe(500);
    expect((await deps.carts.get(SHOP, cart.id!))!.status).toBe("CREATED");
    deps.orders.fail = null;
    const ok = await checkoutCart(SHOP, cart.id!, checkoutBody(cart), deps);
    expect(ok.status).toBe(200);
    expect(deps.payments.authorized.map((a) => a.requestId)).toEqual([`${cart.id}-authorize`, `${cart.id}-authorize`]);
  });
});
