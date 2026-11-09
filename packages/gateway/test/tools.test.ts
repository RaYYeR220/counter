import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import {
  JsonShopDirectory,
  StoreSyncClient,
  generateGatewayKeyPair,
  registerCounterTools,
  type CatalogFeed,
  type GatewayKeyPair,
  type OrderLookup,
} from "../src/index";
import {
  AUSTIN,
  BUYER,
  MERCHANTS,
  NOW,
  PAYER_ID,
  SHOP_BASE,
  loadSeed,
  makeShop,
  storeSyncFetch,
  type SeenRequest,
  type Shop,
} from "./harness";

const SHOP = "juniper-clay";
const SAGE_12 = "JC-MUG-SPECKLE-SAGE-12";
const INK_16 = "JC-MUG-SPECKLE-INK-16";
const TOOLS = [
  "list_shops",
  "search_products",
  "get_product",
  "create_cart",
  "update_cart",
  "checkout",
  "order_status",
];

let keys: GatewayKeyPair;
beforeAll(async () => {
  keys = await generateGatewayKeyPair();
});

interface Result {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, any>;
}

let shop: Shop;
let seen: SeenRequest[];
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}): Promise<Result> {
  return (await client.callTool({ name, arguments: args })) as unknown as Result;
}

function text(r: Result): string {
  return r.content.map((c) => c.text ?? "").join("\n");
}

async function newCart(items = [{ variant_id: SAGE_12, quantity: 1 }]) {
  const r = await call("create_cart", { shop: SHOP, items, shipping_address: AUSTIN, customer: BUYER });
  expect(r.isError ?? false).toBe(false);
  return r.structuredContent!;
}

beforeEach(async () => {
  shop = makeShop();
  const http = storeSyncFetch(shop, keys.publicKeyPem);
  seen = http.seen;
  const storeSync = new StoreSyncClient({
    baseUrl: (slug) => `${SHOP_BASE}/s/${slug}/paypal/v1`,
    merchantIdFor: async (slug) => {
      const id = MERCHANTS[slug];
      if (!id) throw new Error(`Unknown shop ${slug}`);
      return id;
    },
    clientIdentifier: "Counter",
    fetch: http.fetch,
    privateKeyPem: keys.privateKeyPem,
    now: () => NOW,
  });
  const orders: OrderLookup = shop.paypal;
  const server = new McpServer({ name: "counter", version: "test" });
  registerCounterTools(server, {
    directory: new JsonShopDirectory(loadSeed<CatalogFeed>(), { now: () => NOW }),
    storeSync,
    orders,
    publicBaseUrl: SHOP_BASE,
    defaultCustomer: { name: { given_name: "Sam", surname: "Default" }, email_address: "sam@example.com" },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientSide);
});

describe("tools/list", () => {
  it("returns exactly the seven Counter tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
  });

  it("describes the buying rules to the agent", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const name of ["search_products", "create_cart"]) {
      const d = byName[name]!.description!;
      // The shop's own words count when matching what the user asked for...
      expect(d).toMatch(/shop's own words/i);
      expect(d).toMatch(/creamy off-white/);
      // ...but nothing the user did not ask for is swapped in.
      for (const kind of [/size/, /grind/, /decaf/, /seconds/, /dye lot/]) expect(d).toMatch(kind);
      expect(d).toMatch(/out of stock/i);
      expect(d).toMatch(/don't buy/i);
    }
    expect(byName.checkout!.description).toMatch(/approve_url/);
  });

  it("publishes strict input schemas", async () => {
    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === "create_cart")!;
    expect(create.inputSchema.additionalProperties).toBe(false);
    expect(create.inputSchema.required).toEqual(expect.arrayContaining(["shop", "items", "shipping_address"]));
    const r = await call("create_cart", {
      shop: SHOP,
      items: [{ variant_id: SAGE_12, quantity: 1, price: "1.00" }],
      shipping_address: AUSTIN,
    });
    expect(r.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });
});

describe("discovery", () => {
  it("list_shops lists every shop with its link", async () => {
    const r = await call("list_shops");
    const shops = r.structuredContent!.shops as Array<Record<string, unknown>>;
    expect(shops.map((s) => s.shop)).toEqual(["juniper-clay", "northpaw-roasters", "loop-and-lantern"]);
    expect(shops[0]).toMatchObject({ name: "Juniper Clay", url: `${SHOP_BASE}/s/juniper-clay` });
    expect(text(r)).toContain("Juniper Clay");
  });

  it("search_products puts the exact variant first", async () => {
    const r = await call("search_products", { query: "green speckled mug 12 oz" });
    expect(r.structuredContent!.results[0]).toMatchObject({ variant_id: SAGE_12, price: "34.00", in_stock: true });
    expect(text(r).split("\n").find((l) => l.includes("JC-MUG"))).toContain(SAGE_12);
  });

  it("search_products shows out-of-stock variants, flagged", async () => {
    const r = await call("search_products", { query: "ink 16 oz speckled mug", shop: SHOP, limit: 3 });
    expect(r.structuredContent!.results[0]).toMatchObject({ variant_id: INK_16, in_stock: false });
    expect(text(r)).toMatch(/JC-MUG-SPECKLE-INK-16.*out of stock/);
  });

  it("search_products says so when nothing matches", async () => {
    const r = await call("search_products", { query: "titanium bicycle" });
    expect(r.structuredContent!.results).toEqual([]);
    expect(text(r)).toMatch(/no products match/i);
  });

  it("get_product returns every variant with delivery estimates", async () => {
    const r = await call("get_product", { shop: SHOP, parent_id: "JC-MUG-SPECKLE" });
    expect(r.structuredContent!.variants).toHaveLength(12);
    expect(text(r)).toMatch(/JC-MUG-SPECKLE-INK-16.*out of stock/);
    expect(text(r)).toContain("2026-11-18");
  });

  it("search_products names each hit's product, so get_product can be called with it", async () => {
    const r = await call("search_products", { query: "green speckled mug 12 oz", shop: SHOP, limit: 3 });
    expect(r.structuredContent!.results[0]).toMatchObject({ variant_id: SAGE_12, parent_id: "JC-MUG-SPECKLE" });
    const line = text(r).split("\n").find((l) => l.startsWith(SAGE_12))!;
    expect(line).toMatch(/product JC-MUG-SPECKLE\b/);
  });

  it("get_product also takes a variant id and shows that variant's product", async () => {
    const r = await call("get_product", { shop: SHOP, parent_id: "JC-POUROVER-OAT" });
    expect(r.isError ?? false).toBe(false);
    expect(r.structuredContent!.parent_id).toBe("JC-POUROVER");
    expect(text(r)).toMatch(/JC-POUROVER-OAT/);
  });

  it("get_product gives the agent the shop's description, which says what each glaze looks like", async () => {
    const r = await call("get_product", { shop: SHOP, parent_id: "JC-POUROVER" });
    expect(text(r)).toContain("oat (creamy off-white)");
  });

  it("get_product reports an unknown product as an error", async () => {
    const r = await call("get_product", { shop: SHOP, parent_id: "NOPE" });
    expect(r.isError).toBe(true);
  });
});

describe("create_cart", () => {
  it("creates a priced cart with a PayPal order and a one-line total", async () => {
    const r = await call("create_cart", { shop: SHOP, items: [{ variant_id: SAGE_12, quantity: 1 }], shipping_address: AUSTIN, customer: BUYER });
    const cart = r.structuredContent!;
    const orderId = shop.paypal.created[0]!.orderId;
    expect(cart).toMatchObject({
      shop: SHOP,
      status: "CREATED",
      validation_status: "VALID",
      ready_for_checkout: true,
      paypal_order_id: orderId,
      totals: { currency: "USD", subtotal: "34.00", shipping: "5.99", tax: "2.90", total: "42.89" },
      items: [{ variant_id: SAGE_12, quantity: 1, unit_price: "34.00", line_total: "34.00" }],
      validation_issues: [],
    });
    expect(cart.cart_id).toMatch(/^CART-/);
    expect(text(r)).toContain(`Subtotal $34.00 · Shipping $5.99 · Tax $2.90 · Total $42.89 · PayPal order ${orderId}`);
  });

  it("sends the shop a Store Sync create with the buyer and address", async () => {
    await newCart();
    expect(seen[0]).toMatchObject({
      method: "POST",
      path: `/s/${SHOP}/paypal/v1/merchant-cart`,
      body: {
        items: [{ variant_id: SAGE_12, quantity: 1 }],
        customer: BUYER,
        shipping_address: AUSTIN,
        payment_method: { type: "paypal" },
      },
    });
  });

  it("falls back to the default customer", async () => {
    await call("create_cart", { shop: SHOP, items: [{ variant_id: SAGE_12, quantity: 1 }], shipping_address: AUSTIN });
    expect(seen[0]!.body).toMatchObject({ customer: { name: { given_name: "Sam", surname: "Default" } } });
  });

  it("passes the shop's validation issues through verbatim", async () => {
    const r = await call("create_cart", {
      shop: SHOP,
      items: [
        { variant_id: SAGE_12, quantity: 1 },
        { variant_id: INK_16, quantity: 1 },
      ],
      shipping_address: AUSTIN,
    });
    expect(r.isError ?? false).toBe(false);
    const cart = r.structuredContent!;
    expect(cart).toMatchObject({ status: "INCOMPLETE", ready_for_checkout: false, paypal_order_id: null });
    const issue = cart.validation_issues[0];
    expect(issue).toMatchObject({
      code: "INVENTORY_ISSUE",
      variant_id: INK_16,
      context: { specific_issue: "ITEM_OUT_OF_STOCK" },
      resolution_options: [{ action: "REMOVE_ITEM" }],
    });
    expect(text(r)).toContain(issue.user_message);
    expect(text(r)).toContain(issue.resolution_options[0].label);
  });

  it("returns the shop's 422 as a tool error with its issues", async () => {
    const r = await call("create_cart", { shop: SHOP, items: [{ variant_id: "NOPE-1", quantity: 1 }], shipping_address: AUSTIN });
    expect(r.isError).toBe(true);
    expect(r.structuredContent!.error).toMatchObject({ status: 422, issues: [{ context: { specific_issue: "ITEM_NOT_FOUND" } }] });
    expect(text(r)).toContain("This product is not available from this store.");
  });

  it("reports an unknown shop as an error", async () => {
    const r = await call("create_cart", { shop: "nope", items: [{ variant_id: SAGE_12, quantity: 1 }], shipping_address: AUSTIN });
    expect(r.isError).toBe(true);
  });
});

describe("update_cart", () => {
  it("re-prices a new quantity and sends a full replacement", async () => {
    const cart = await newCart();
    const r = await call("update_cart", { shop: SHOP, cart_id: cart.cart_id, items: [{ variant_id: SAGE_12, quantity: 2 }] });
    expect(r.structuredContent).toMatchObject({
      status: "CREATED",
      paypal_order_id: cart.paypal_order_id,
      totals: { subtotal: "68.00", shipping: "5.99", tax: "5.36", total: "79.35" },
    });
    const put = seen.find((s) => s.method === "PUT")!;
    expect(put.path).toBe(`/s/${SHOP}/paypal/v1/merchant-cart/${cart.cart_id}`);
    expect(put.body).toMatchObject({
      id: cart.cart_id,
      items: [{ variant_id: SAGE_12, quantity: 2 }],
      customer: BUYER,
      shipping_address: AUSTIN,
      payment_method: { type: "paypal", token: cart.paypal_order_id },
      available_shipping_options: [
        { id: "STANDARD", is_selected: true },
        { id: "EXPRESS", is_selected: false },
      ],
    });
    expect(Object.keys(put.body as object)).not.toContain("totals");
  });

  it("switches the shipping option", async () => {
    const cart = await newCart();
    const r = await call("update_cart", { shop: SHOP, cart_id: cart.cart_id, shipping_option_id: "EXPRESS" });
    expect(r.structuredContent!.totals).toMatchObject({ shipping: "14.99" });
    expect(r.structuredContent!.shipping_options).toEqual([
      expect.objectContaining({ id: "STANDARD", selected: false }),
      expect.objectContaining({ id: "EXPRESS", selected: true }),
    ]);
  });

  it("replaces the address and keeps the rest of the cart", async () => {
    const cart = await newCart();
    const portland = { ...AUSTIN, admin_area_2: "Portland", admin_area_1: "OR", postal_code: "97201" };
    const r = await call("update_cart", { shop: SHOP, cart_id: cart.cart_id, shipping_address: portland });
    expect(r.structuredContent).toMatchObject({
      shipping_address: portland,
      customer: BUYER,
      items: [{ variant_id: SAGE_12, quantity: 1 }],
      totals: { tax: "0.00" },
    });
  });

  it("says so when the requested shipping option is not offered", async () => {
    const cart = await newCart();
    const r = await call("update_cart", { shop: SHOP, cart_id: cart.cart_id, shipping_option_id: "OVERNIGHT" });
    expect(r.structuredContent!.totals).toMatchObject({ shipping: "5.99" });
    expect(text(r)).toMatch(/OVERNIGHT is not offered.*STANDARD is selected/);
  });

  it("refuses to change a cart that is already ordered", async () => {
    const cart = await newCart();
    shop.paypal.approve(cart.paypal_order_id);
    await call("checkout", { shop: SHOP, cart_id: cart.cart_id });
    const puts = seen.filter((s) => s.method === "PUT").length;
    const r = await call("update_cart", { shop: SHOP, cart_id: cart.cart_id, items: [{ variant_id: SAGE_12, quantity: 3 }] });
    expect(r.isError).toBe(true);
    expect(r.structuredContent!.error).toMatchObject({ name: "CART_COMPLETED" });
    expect(seen.filter((s) => s.method === "PUT")).toHaveLength(puts);
  });

  it("passes a missing cart through as an error", async () => {
    const r = await call("update_cart", { shop: SHOP, cart_id: "CART-NOPE000001", items: [{ variant_id: SAGE_12, quantity: 1 }] });
    expect(r.isError).toBe(true);
    expect(r.structuredContent!.error).toMatchObject({ status: 404, name: "CART_NOT_FOUND" });
  });
});

describe("checkout", () => {
  it("asks for the buyer's approval first, without calling the shop's checkout", async () => {
    const cart = await newCart();
    const r = await call("checkout", { shop: SHOP, cart_id: cart.cart_id });
    expect(r.isError ?? false).toBe(false);
    expect(r.structuredContent).toMatchObject({
      needs_approval: true,
      approve_url: `https://www.sandbox.paypal.com/checkoutnow?token=${cart.paypal_order_id}`,
      paypal_order_id: cart.paypal_order_id,
    });
    expect(r.structuredContent!.message).toMatch(/approve/i);
    expect(text(r)).toContain(r.structuredContent!.approve_url);
    expect(seen.some((s) => s.path.endsWith("/checkout"))).toBe(false);
  });

  it("completes once the buyer has approved, returning the order number", async () => {
    const cart = await newCart();
    shop.paypal.approve(cart.paypal_order_id);
    const r = await call("checkout", { shop: SHOP, cart_id: cart.cart_id });
    expect(r.structuredContent).toMatchObject({
      needs_approval: false,
      completed: true,
      order_number: "ORD-1001",
      order_review_page: `${SHOP_BASE}/orders/ORD-1001`,
      paypal_order_id: cart.paypal_order_id,
    });
    expect(text(r)).toContain("ORD-1001");
    expect(text(r)).toContain("Total $42.89");
    const post = seen.at(-1)!;
    expect(post.path).toBe(`/s/${SHOP}/paypal/v1/merchant-cart/${cart.cart_id}/checkout`);
    expect(post.scope).toEqual(["cart", "checkout"]);
    expect(post.body).toMatchObject({
      items: [{ variant_id: SAGE_12, quantity: 1 }],
      payment_method: { type: "paypal", token: cart.paypal_order_id, payer_id: PAYER_ID },
    });
    expect(shop.orderBook.booked).toHaveLength(1);
  });

  it("returns the same order when called again", async () => {
    const cart = await newCart();
    shop.paypal.approve(cart.paypal_order_id);
    await call("checkout", { shop: SHOP, cart_id: cart.cart_id });
    const again = await call("checkout", { shop: SHOP, cart_id: cart.cart_id });
    expect(again.structuredContent).toMatchObject({ completed: true, order_number: "ORD-1001" });
    expect(shop.orderBook.booked).toHaveLength(1);
  });

  it("refuses a cart that still has issues", async () => {
    const cart = await newCart([{ variant_id: INK_16, quantity: 1 }]);
    const r = await call("checkout", { shop: SHOP, cart_id: cart.cart_id });
    expect(r.structuredContent).toMatchObject({ needs_approval: false, completed: false });
    expect(r.structuredContent!.cart.validation_issues[0]).toMatchObject({ variant_id: INK_16 });
    expect(seen.some((s) => s.path.endsWith("/checkout"))).toBe(false);
  });
});

describe("order_status", () => {
  it("follows a cart from approval to a placed order", async () => {
    const cart = await newCart();
    const pending = await call("order_status", { shop: SHOP, cart_id: cart.cart_id });
    expect(pending.structuredContent).toMatchObject({
      cart_status: "CREATED",
      payment_status: "AWAITING_APPROVAL",
      approve_url: `https://www.sandbox.paypal.com/checkoutnow?token=${cart.paypal_order_id}`,
    });

    shop.paypal.approve(cart.paypal_order_id);
    const approved = await call("order_status", { shop: SHOP, cart_id: cart.cart_id });
    expect(approved.structuredContent).toMatchObject({ payment_status: "APPROVED" });
    expect(approved.structuredContent!.message).toMatch(/checkout/);

    await call("checkout", { shop: SHOP, cart_id: cart.cart_id });
    const done = await call("order_status", { shop: SHOP, cart_id: cart.cart_id });
    expect(done.structuredContent).toMatchObject({
      cart_status: "COMPLETED",
      payment_status: "COMPLETED",
      order_number: "ORD-1001",
    });
    expect(text(done)).toContain("ORD-1001");
  });
});
