import { beforeEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import {
  APP_MODEL_JS,
  COUNTER_APPS,
  JsonShopDirectory,
  StoreSyncClient,
  registerCounterTools,
  type CatalogFeed,
} from "../src/index";
import { NOW, SHOP_BASE, loadSeed } from "./harness";

const MCP_APP_MIME = "text/html;profile=mcp-app";
const PRODUCT = "ui://counter/product.html";
const CART = "ui://counter/cart.html";
const APPROVAL = "ui://counter/approval.html";

let client: Client;

beforeEach(async () => {
  const server = new McpServer({ name: "counter", version: "test" });
  registerCounterTools(server, {
    directory: new JsonShopDirectory(loadSeed<CatalogFeed>(), { now: () => NOW }),
    storeSync: new StoreSyncClient({
      baseUrl: (slug) => `${SHOP_BASE}/s/${slug}/paypal/v1`,
      merchantIdFor: async () => "UNUSED",
      clientIdentifier: "Counter",
      fetch: (async () => new Response("{}", { status: 500 })) as typeof fetch,
      privateKeyPem: "unused",
      now: () => NOW,
    }),
    orders: { approvalState: async () => ({ status: "UNKNOWN" as const, approveUrl: "" }) },
    publicBaseUrl: SHOP_BASE,
    negotiator: { haggle: async () => ({ reply: "no", verdict: "none" as const }) },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "apps-host", version: "1.0.0" });
  await client.connect(clientSide);
});

async function toolMeta(): Promise<Record<string, Record<string, any> | undefined>> {
  const { tools } = await client.listTools();
  return Object.fromEntries(tools.map((t) => [t.name, t._meta as Record<string, any> | undefined]));
}

async function read(uri: string) {
  const r = await client.readResource({ uri });
  expect(r.contents).toHaveLength(1);
  return r.contents[0] as { uri: string; mimeType?: string; text?: string; _meta?: Record<string, any> };
}

describe("tool UI metadata", () => {
  it("links each card to the tools that show it", async () => {
    const meta = await toolMeta();
    const expected: Record<string, string> = {
      get_product: PRODUCT,
      create_cart: CART,
      update_cart: CART,
      checkout: APPROVAL,
      order_status: APPROVAL,
    };
    for (const [tool, uri] of Object.entries(expected)) {
      expect(meta[tool]?.ui?.resourceUri, tool).toBe(uri);
      // Hosts that predate the nested key read the flat one.
      expect(meta[tool]?.["ui/resourceUri"], tool).toBe(uri);
    }
  });

  it("leaves the discovery and negotiation tools without a card", async () => {
    const meta = await toolMeta();
    for (const tool of ["list_shops", "search_products", "negotiate"]) {
      expect(meta[tool]?.ui, tool).toBeUndefined();
      expect(meta[tool]?.["ui/resourceUri"], tool).toBeUndefined();
    }
  });

  it("lets the approval card call checkout again, and keeps every tool visible to the model", async () => {
    const meta = await toolMeta();
    expect(meta.checkout?.ui?.visibility).toEqual(["model", "app"]);
    for (const tool of ["get_product", "create_cart", "update_cart", "order_status"]) {
      expect(meta[tool]?.ui?.visibility ?? ["model", "app"], tool).toContain("model");
    }
  });
});

describe("UI resources", () => {
  it("lists the three cards as MCP App resources", async () => {
    const { resources } = await client.listResources();
    const apps = resources.filter((r) => r.uri.startsWith("ui://"));
    expect(apps.map((r) => r.uri).sort()).toEqual([APPROVAL, CART, PRODUCT]);
    for (const r of apps) expect(r.mimeType, r.uri).toBe(MCP_APP_MIME);
  });

  it.each([
    [PRODUCT, "product", ["Sold out", "variant"]],
    [CART, "cart", ["PayPal holds the payment until the shop ships", "Discount"]],
    [APPROVAL, "approval", ["Approve in PayPal", "finish the order", "tools/call", "ui/open-link"]],
  ])("serves %s as a self-contained page", async (uri, name, markers) => {
    const c = await read(uri);
    expect(c.uri).toBe(uri);
    expect(c.mimeType).toBe(MCP_APP_MIME);
    const html = c.text!;
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(`data-counter-app="${name}"`);
    // The MCP Apps handshake and auto-sizing.
    expect(html).toContain("ui/initialize");
    expect(html).toContain("ui/notifications/initialized");
    expect(html).toContain("ui/notifications/tool-result");
    expect(html).toContain("ui/notifications/size-changed");
    expect(html).toContain("prefers-color-scheme: dark");
    for (const m of markers) expect(html, m).toContain(m);
  });

  it.each([PRODUCT, CART, APPROVAL])("%s loads nothing from the network and calls nothing itself", async (uri) => {
    const c = await read(uri);
    const html = c.text!;
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/@import|url\(\s*["']?https?:/i);
    expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
    // The declared policy matches: no outside origins at all.
    expect(c._meta?.ui?.csp).toEqual({ connectDomains: [], resourceDomains: [] });
    expect(c._meta?.ui?.prefersBorder).toBe(false);
  });

  it.each(Object.entries(COUNTER_APPS))("the %s card's scripts parse", (_name, app) => {
    const scripts = [...app.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(() => new Function(s)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The view model every card renders from: it only reads the tool result.

interface Model {
  money(v: string | undefined): string;
  day(iso: string | undefined): string;
  splitName(name: string | undefined): { title: string; detail: string };
  cap(values: string): string;
  safeUrl(u: unknown): string | null;
  stockLabel(v: { in_stock: boolean; purchasable: boolean; stock: number }): string;
  pickVariant(p: { variants: Array<Record<string, any>> }, requested?: string): Record<string, any> | undefined;
  issues(result: Record<string, any>): string[];
  checkoutState(result: Record<string, any>, args?: Record<string, any>): Record<string, any>;
}

function model(): Model {
  return new Function(`${APP_MODEL_JS}\nreturn counterModel();`)() as Model;
}

const CART_VIEW = {
  shop: "juniper-clay",
  cart_id: "CART-G000000001",
  status: "CREATED",
  validation_status: "VALID",
  ready_for_checkout: true,
  items: [],
  shipping_options: [],
  totals: { currency: "USD", subtotal: "34.00", shipping: "5.99", tax: "2.90", total: "42.89" },
  paypal_order_id: "5O190001TN364715T",
  validation_issues: [],
  next_step: "",
};

describe("card view model", () => {
  const m = model();

  it("formats money and delivery days", () => {
    expect(m.money("34.00")).toBe("$34.00");
    expect(m.money(undefined)).toBe("$0.00");
    expect(m.day("2026-11-18")).toBe("Wed, Nov 18");
  });

  it("splits a shop's line name into the product and its attributes", () => {
    expect(m.splitName("Speckled mug (Sage, 12 oz)")).toEqual({ title: "Speckled mug", detail: "Sage, 12 oz" });
    expect(m.splitName("Gift card")).toEqual({ title: "Gift card", detail: "" });
  });

  it("capitalises each attribute value for display", () => {
    expect(m.cap("sage, 12 oz")).toBe("Sage, 12 oz");
    expect(m.cap("oat")).toBe("Oat");
    expect(m.cap("")).toBe("");
  });

  it("opens only web links", () => {
    expect(m.safeUrl("https://www.sandbox.paypal.com/checkoutnow?token=5O19")).toBe(
      "https://www.sandbox.paypal.com/checkoutnow?token=5O19",
    );
    expect(m.safeUrl("http://localhost:3000/orders/ORD-1")).toBe("http://localhost:3000/orders/ORD-1");
    expect(m.safeUrl("javascript:alert(1)")).toBeNull();
    expect(m.safeUrl("")).toBeNull();
    expect(m.safeUrl(undefined)).toBeNull();
  });

  it("labels stock the way a shop would", () => {
    expect(m.stockLabel({ in_stock: false, purchasable: true, stock: 0 })).toBe("Sold out");
    expect(m.stockLabel({ in_stock: true, purchasable: false, stock: 5 })).toBe("Not sold on its own");
    expect(m.stockLabel({ in_stock: true, purchasable: true, stock: 2 })).toBe("Only 2 left");
    expect(m.stockLabel({ in_stock: true, purchasable: true, stock: 14 })).toBe("14 in stock");
  });

  it("opens the variant that was asked for, else the first one that can be bought", () => {
    const variants = [
      { variant_id: "A", in_stock: false, purchasable: true },
      { variant_id: "B", in_stock: true, purchasable: true },
      { variant_id: "C", in_stock: true, purchasable: true },
    ];
    expect(m.pickVariant({ variants }, "c")?.variant_id).toBe("C");
    expect(m.pickVariant({ variants }, "PARENT")?.variant_id).toBe("B");
    expect(m.pickVariant({ variants: [] })).toBeUndefined();
  });

  it("collects what the shop says to the buyer", () => {
    const issue = { code: "ITEM_OUT_OF_STOCK", message: "out", user_message: "The ink 16 oz mug is sold out." };
    expect(m.issues({ structuredContent: { ...CART_VIEW, validation_issues: [issue] } })).toEqual([
      "The ink 16 oz mug is sold out.",
    ]);
    expect(m.issues({ structuredContent: { cart: { ...CART_VIEW, validation_issues: [{ code: "X", message: "Raw" }] } } })).toEqual([
      "Raw",
    ]);
    expect(m.issues({ isError: true, structuredContent: { error: { issues: [issue] } } })).toEqual([
      "The ink 16 oz mug is sold out.",
    ]);
  });

  it("asks for approval while PayPal waits on the buyer", () => {
    const s = m.checkoutState({
      structuredContent: {
        needs_approval: true,
        completed: false,
        approve_url: "https://www.sandbox.paypal.com/checkoutnow?token=5O190001TN364715T",
        paypal_order_id: "5O190001TN364715T",
        message: "The user has not approved this payment yet.",
        cart: CART_VIEW,
      },
    });
    expect(s).toMatchObject({
      kind: "approve",
      approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=5O190001TN364715T",
      shop: "juniper-clay",
      cartId: "CART-G000000001",
      total: "42.89",
      paypalOrderId: "5O190001TN364715T",
    });
  });

  it("shows the order once it is placed", () => {
    const s = m.checkoutState({
      structuredContent: {
        needs_approval: false,
        completed: true,
        order_number: "ORD-1001",
        order_review_page: "https://counter.test/orders/ORD-1001",
        paypal_order_id: "5O190001TN364715T",
        message: "Order placed",
        cart: CART_VIEW,
      },
    });
    expect(s).toMatchObject({ kind: "done", orderNumber: "ORD-1001", reviewUrl: "https://counter.test/orders/ORD-1001" });
  });

  it("explains a cart that cannot be checked out yet", () => {
    const issue = { code: "ITEM_OUT_OF_STOCK", message: "out", user_message: "Sold out." };
    const s = m.checkoutState({
      structuredContent: {
        needs_approval: false,
        completed: false,
        paypal_order_id: null,
        message: "This cart cannot be checked out yet.",
        cart: { ...CART_VIEW, ready_for_checkout: false, validation_issues: [issue] },
      },
    });
    expect(s).toMatchObject({ kind: "blocked", message: "This cart cannot be checked out yet.", issues: ["Sold out."] });
  });

  it("reads order_status the same way", () => {
    const base = { shop: "juniper-clay", cart_id: "CART-G000000001", cart_status: "CREATED", paypal_order_id: "5O19", cart: CART_VIEW };
    expect(
      m.checkoutState({ structuredContent: { ...base, payment_status: "AWAITING_APPROVAL", approve_url: "https://paypal.test/a", message: "" } }),
    ).toMatchObject({ kind: "approve", approveUrl: "https://paypal.test/a", cartId: "CART-G000000001" });
    expect(m.checkoutState({ structuredContent: { ...base, payment_status: "APPROVED", message: "" } })).toMatchObject({ kind: "finish" });
    expect(
      m.checkoutState({
        structuredContent: { ...base, cart_status: "COMPLETED", payment_status: "COMPLETED", order_number: "ORD-1001", order_review_page: "https://counter.test/orders/ORD-1001", message: "" },
      }),
    ).toMatchObject({ kind: "done", orderNumber: "ORD-1001" });
    expect(m.checkoutState({ structuredContent: { ...base, payment_status: "UNKNOWN", message: "PayPal does not report this payment." } })).toMatchObject({
      kind: "blocked",
      paymentStatus: "UNKNOWN",
      message: "PayPal does not report this payment.",
    });
  });

  it("falls back to the call's arguments for the cart to finish", () => {
    const s = m.checkoutState(
      { structuredContent: { needs_approval: true, completed: false, approve_url: "https://paypal.test/a", paypal_order_id: "5O19", message: "", cart: { ...CART_VIEW, shop: "", cart_id: "" } } },
      { shop: "juniper-clay", cart_id: "CART-ARG" },
    );
    expect(s).toMatchObject({ shop: "juniper-clay", cartId: "CART-ARG" });
  });

  it("reports a failed call with the shop's words", () => {
    const s = m.checkoutState({
      isError: true,
      content: [{ type: "text", text: "Checkout failed (422 UNPROCESSABLE_ENTITY): nope" }],
      structuredContent: { error: { status: 422, name: "UNPROCESSABLE_ENTITY", message: "nope", issues: [{ code: "X", message: "m", user_message: "Pick another size." }] } },
    });
    expect(s).toMatchObject({ kind: "error", message: "nope", issues: ["Pick another size."] });
  });
});
