/**
 * Node port of PayPal's "PayPal Agentic Commerce" Postman collection.
 *
 * Requests run in the collection's run order against the handlers, behind the
 * same JWT check the HTTP routes use. Bodies are the collection's templates,
 * rendered with its variable substitution. After each request we apply the
 * collection-level tests (C1-C8, latency) or the Common Error Scenarios folder
 * tests (E1-E7), plus that request's own tests, and update the collection
 * variables exactly as the scripts do.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair, type CryptoKey } from "jose";
import { BusinessErrorSchema, PayPalCartSchema } from "@paypal/commerce-cart-zod";
import {
  PAYPAL_JWKS_URL,
  SCOPES,
  checkoutCart,
  createCart,
  getCart,
  replaceCart,
  verifyPayPalJwt,
} from "../src/index";
import { BOWL, MUG, OOS, SHOP, TEE } from "./fixtures";
import { makeDeps } from "./harness";

// ---------------------------------------------------------------------------
// Environment

const BASE_URL = "https://counter.example/s/juniper-clay/paypal/v1";
const MERCHANT_ACCOUNT = "ZT3XQ8M2L9KPA";

const vars: Record<string, string> = {
  item_parent_id: MUG.parentId,
  item_variant_id: MUG.variantId,
  // The Oregon request still uses the collection's older variable names.
  parent_id: MUG.parentId,
  variant_id: MUG.variantId,
  items: JSON.stringify([MUG, TEE, BOWL].map((v) => ({ parent_id: v.parentId, variant_id: v.variantId }))),
  out_of_stock_item_parent_id: OOS.parentId,
  out_of_stock_item_variant_id: OOS.variantId,
  payer_id: "QYR5Z8XDVJNXQ",
  is_braintree_merchant: "false",
  jwt_merchant_id: "merchant-id",
  jwt_audience: "platform.com",
  jwt_paypal_account_id: MERCHANT_ACCOUNT,
};

const deps = makeDeps();
deps.payments.requireApproval = true;

let signingKey: CryptoKey;
let verifyKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  verifyKey = pair.publicKey;
});

/** The collection prerequest: a self-signed RS256 token carrying PayPal's production kid. */
async function collectionJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const sources = ["Meta", "Perplexity", "Copilot"];
  const storeId = String(Math.floor(Math.random() * 9e18 + 1e18));
  return new SignJWT({
    iss: "paypal.com",
    sub: vars.jwt_merchant_id,
    aud: vars.jwt_audience,
    iat: now,
    exp: now + 3600,
    scope: ["cart", "checkout"],
    external_id: [
      `PayPal:${vars.jwt_paypal_account_id}`,
      `Honey:${storeId}`,
      `Client_Identifier:${sources[Math.floor(Math.random() * sources.length)]}`,
    ],
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "5874bc103b80920f" })
    .sign(signingKey);
}

/** Postman-style substitution: unresolved variables are sent literally. */
function render(template: string): string {
  return template.replace(/\{\{([^{}]+)\}\}/g, (whole, name: string) => vars[name] ?? whole);
}

// ---------------------------------------------------------------------------
// A minimal HTTP surface: auth first, then routing, JSON over the wire.

interface Exchange {
  method: string;
  url: string;
  status: number;
  body: any;
  responseTime: number;
}

async function serve(method: string, path: string, authorization: string, rawBody: string) {
  const checkout = /\/checkout$/.test(path);
  const auth = await verifyPayPalJwt(authorization, {
    mode: "sandbox",
    sandboxKeys: [verifyKey],
    jwksUrl: PAYPAL_JWKS_URL,
    merchantId: MERCHANT_ACCOUNT,
    requiredScopes: checkout ? SCOPES.checkout : SCOPES.cart,
  });
  if (!auth.ok) return { status: auth.status, body: auth.body };

  let m: RegExpExecArray | null;
  if (method === "POST" && path === "/merchant-cart") {
    return createCart(SHOP, rawBody, deps, { clientIdentifier: auth.clientIdentifier });
  }
  if ((m = /^\/merchant-cart\/([^/]+)$/.exec(path))) {
    const id = decodeURIComponent(m[1]!);
    if (method === "GET") return getCart(SHOP, id, deps);
    if (method === "PUT") return replaceCart(SHOP, id, rawBody, deps);
  }
  if (method === "POST" && (m = /^\/merchant-cart\/([^/]+)\/checkout$/.exec(path))) {
    return checkoutCart(SHOP, decodeURIComponent(m[1]!), rawBody, deps);
  }
  return { status: 404, body: { name: "NOT_FOUND", message: "No such resource" } };
}

interface RequestSpec {
  method: "POST" | "PUT" | "GET";
  path: string;
  body: string;
  authorization?: string;
  prerequest?: () => void;
  /** Collection-level tests run (false for the Common Error Scenarios folder). */
  collection: boolean;
}

/** Sends the request in a beforeAll hook and returns a getter for the exchange. */
function send(spec: RequestSpec): () => Exchange {
  let ex: Exchange | undefined;
  beforeAll(async () => {
    spec.prerequest?.();
    const path = render(spec.path);
    const authorization = render(spec.authorization ?? `Bearer ${await collectionJwt()}`);
    const started = performance.now();
    const res = await serve(spec.method, path, authorization, render(spec.body));
    ex = {
      method: spec.method,
      url: BASE_URL + path,
      status: res.status,
      body: JSON.parse(JSON.stringify(res.body)),
      responseTime: performance.now() - started,
    };
    if (spec.collection) captureCollectionVariables(ex.body);
  });
  return () => {
    if (!ex) throw new Error("request was not sent");
    return ex;
  };
}

// ---------------------------------------------------------------------------
// Collection-level test (runs after every non-error request)

function captureCollectionVariables(response: any) {
  if (response.id) vars.cart_id = response.id;
  if (Array.isArray(response.items) && response.items.length > 0) vars.item_quantity = String(response.items[0].quantity);
  if (vars.is_braintree_merchant !== "true" && response.payment_method?.token) {
    vars.ec_token = response.payment_method.token;
  }
  const opts = response.available_shipping_options;
  if (Array.isArray(opts) && opts.length >= 1 && opts.filter((o) => o.is_selected === true).length === 1) {
    vars.available_shipping_options = JSON.stringify(opts);
  }
}

const toCentsLikePostman = (str: string) => Math.round(parseFloat(str) * 100);

function collectionTests(get: () => Exchange, opts: { checkout?: boolean } = {}) {
  it("Response time under 3s for create cart / update cart", () => {
    const { url, method, responseTime } = get();
    if (/\/merchant-cart$/.test(url) || method === "PUT") expect(responseTime).toBeLessThan(3000);
  });

  it("C1 Response contains valid PayPalCart properties", () => {
    const result = PayPalCartSchema.safeParse(get().body);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  if (opts.checkout) {
    // The collection asks checkout for payment_confirmation, which the strict
    // 1.4.0 schema does not list, so C2 cannot pass on either checkout.
    it.fails("C2 Response contains only recognized PayPalCart properties (for awareness)", () => {
      expect(PayPalCartSchema.strict().safeParse(get().body).success).toBe(true);
    });
    it("C2 (checkout) payment_confirmation is the only unrecognized property", () => {
      const { payment_confirmation: _pc, ...rest } = get().body;
      const result = PayPalCartSchema.strict().safeParse(rest);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });
  } else {
    it("C2 Response contains only recognized PayPalCart properties (for awareness)", () => {
      const result = PayPalCartSchema.strict().safeParse(get().body);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });
  }

  it("C3 Response has cart ID and status", () => {
    const r = get().body;
    expect(r.id).toBeTruthy();
    expect(r.status).toBeTruthy();
  });

  it("C4 PayPalCart schema has basic LLM request fields", () => {
    const r = get().body;
    expect(Array.isArray(r.items)).toBe(true);
    expect(r.validation_status).toBeTruthy();
    expect(r.customer).toBeTruthy();
    expect(r.shipping_address).toBeTruthy();
  });

  it("C5 PayPalCart schema has payment info", () => {
    const r = get().body;
    if (vars.is_braintree_merchant !== "true" && r.payment_method) expect(r.payment_method.token).toBeTruthy();
  });

  it("C6 PayPalCart schema has valid available_shipping_options", () => {
    const opts = get().body.available_shipping_options;
    expect(Array.isArray(opts)).toBe(true);
    expect(opts.length).toBeGreaterThanOrEqual(1);
    expect(opts.filter((o: any) => o.is_selected === true)).toHaveLength(1);
  });

  it("C7 PayPalCart schema has valid totals", () => {
    const t = get().body.totals;
    expect(typeof t).toBe("object");
    for (const k of ["total", "subtotal", "tax", "shipping"]) expect(t[k]?.value).toBeDefined();
  });

  it("C8 Item prices x quantities match subtotal", () => {
    const { items, totals } = get().body;
    let sum = 0;
    items.forEach((item: any) => {
      sum += toCentsLikePostman(item.price.value) * parseInt(item.quantity, 10);
    });
    expect(sum).toBe(toCentsLikePostman(totals.subtotal.value));
  });
}

// ---------------------------------------------------------------------------
// Common Error Scenarios folder test

const ERROR_SCENARIOS = {
  ITEM_OUT_OF_STOCK: ["ITEM_OUT_OF_STOCK", "INSUFFICIENT_INVENTORY"],
  ITEM_NOT_FOUND: ["ITEM_NOT_FOUND"],
  PAYMENT_DECLINED: [
    "PAYMENT_DECLINED",
    "PAYMENT_INSUFFICIENT_FUNDS",
    "PAYMENT_EXPIRED",
    "PAYMENT_FRAUD_DETECTED",
    "PAYMENT_PROCESSOR_UNAVAILABLE",
    "PAYMENT_CAPTURE_FAILED",
  ],
  SHIPPING_NOT_AVAILABLE: ["SHIPPING_NOT_AVAILABLE", "SHIPPING_ADDRESS_UNSERVICEABLE"],
  MULTI_ITEM_ERRORS: ["ITEM_OUT_OF_STOCK", "INSUFFICIENT_INVENTORY", "ITEM_NOT_FOUND"],
} as const;

/** The folder's helpers.findErrorIssue. */
function findErrorIssue(response: any, code: string): boolean {
  if (Array.isArray(response.details) && response.details.some((d: any) => d.issue === code)) return true;
  if (response.business_context?.context?.specific_issue === code) return true;
  return (
    Array.isArray(response.validation_issues) &&
    response.validation_issues.some((i: any) => i.context?.specific_issue === code)
  );
}

function errorFolderTests(
  scenario: keyof typeof ERROR_SCENARIOS,
  get: () => Exchange,
  branch: 200 | 422,
  opts: { codesUnpassable?: boolean } = {},
) {
  const codes = ERROR_SCENARIOS[scenario];
  it(`answers on the ${branch} branch`, () => {
    expect(get().status).toBe(branch);
  });
  const codeTest = (fn: () => void, name: string) => (opts.codesUnpassable ? it.fails(name, fn) : it(name, fn));

  if (branch === 200) {
    it("E1 200 response matches PayPalCart Zod schema", () => {
      const result = PayPalCartSchema.safeParse(get().body);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });
    it("E2 Should handle 200 response with validation_issues", () => {
      expect(get().status).toBe(200);
      expect(get().body.validation_issues.length).toBeGreaterThanOrEqual(1);
    });
    codeTest(() => {
      expect(codes.some((c) => findErrorIssue(get().body, c))).toBe(true);
    }, `E3 Should specify correct validation_issues: ${codes.join(",")}`);
  } else {
    it("E4 422 response matches BusinessError Zod schema", () => {
      const result = BusinessErrorSchema.safeParse(get().body);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });
    it("E5 Should handle 422 response with error", () => {
      expect(get().status).toBe(422);
      expect(get().body.name).toBeTruthy();
      expect(get().body.message).toBeTruthy();
    });
    codeTest(() => {
      expect(codes.some((c) => findErrorIssue(get().body, c))).toBe(true);
    }, `E6 Should specify one of the correct error codes: ${codes.join(",")}`);
  }
  it("E7 Has handled the error with 200 or 422 option", () => {
    expect([200, 201, 422]).toContain(get().status);
  });
}

// ---------------------------------------------------------------------------
// Request bodies (the collection's templates)

const JOHN = `{"name":{"given_name":"John","surname":"Doe"},"email_address":"jdoe-pp@paypal.com","phone":{"country_code":"1","national_number":"1234567890"}}`;
const JOHNNY = `{"name":{"given_name":"Johnny","surname":"Dohe"},"email_address":"jdoe2-pp@paypal.com","phone":{"country_code":"1","national_number":"9087654321"}}`;
const SAN_JOSE = `{"address_line_1":"456 Fictional St","address_line_2":"Apt 4B","admin_area_2":"San Jose","admin_area_1":"CA","postal_code":"90210","country_code":"US"}`;
const NEW_YORK = `{"address_line_1":"117 Barrow St","admin_area_2":"New York","admin_area_1":"NY","postal_code":"10014","country_code":"US"}`;
const PORTLAND = `{"address_line_1":"12333 SW 68th Pkwy","admin_area_2":"Portland","admin_area_1":"OR","postal_code":"97223","country_code":"US"}`;
const SYDNEY = `{"address_line_1":"123 Test St","admin_area_2":"Sydney","admin_area_1":"NSW","postal_code":"2000","country_code":"AU"}`;
const BILLING = `{"address_line_1":"2211 N 1st St","admin_area_2":"San Jose","admin_area_1":"CA","postal_code":"95131","country_code":"US"}`;

const PAY_CREATE = `{"type":"paypal"}`;
const PAY_UPDATE = `{"type":"paypal","token":"{{ec_token}}"}`;
const PAY_CHECKOUT = `{"type":"paypal","token":"{{ec_token}}","payer_id":"{{payer_id}}"}`;

function cartJson(p: { id: string; items: string; customer?: string; shipping?: string; options?: boolean; payment: string }) {
  return `{
  "id": "${p.id}",
  "items": ${p.items},
  "customer": ${p.customer ?? JOHN},
  "shipping_address": ${p.shipping ?? SAN_JOSE},
  "billing_address": ${BILLING},${p.options ? `\n  "available_shipping_options": {{available_shipping_options}},` : ""}
  "payment_method": ${p.payment}
}`;
}

const oneItem = (qty: string, parent = "item_parent_id", variant = "item_variant_id") =>
  `[{"parent_id":"{{${parent}}}","variant_id":"{{${variant}}}","quantity":${qty}}]`;

function setUpdatedItems(pick: (all: Array<{ parent_id: string; variant_id: string; quantity: number }>) => unknown[]) {
  const items = (JSON.parse(vars.items!) as Array<{ parent_id: string; variant_id: string }>).map((i) => ({
    parent_id: i.parent_id,
    variant_id: i.variant_id,
    quantity: 1,
  }));
  vars.updated_items = JSON.stringify(pick(items));
}

/** The buyer approves the current PayPal order before each Checkout request. */
function buyerApproves() {
  deps.payments.approve(vars.ec_token!);
}

function expectPayPalOrderMatchesCart(get: () => Exchange) {
  it("PayPal order amount equals the cart total", () => {
    const { body } = get();
    expect(deps.payments.orderTotals.get(body.payment_method.token)).toBe(toCentsLikePostman(body.totals.total.value));
  });
}

// ---------------------------------------------------------------------------
// Cart Operations / Multi Item Flow

describe("Cart Operations / Multi Item Flow / Create Cart", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart",
    collection: true,
    prerequest: () => setUpdatedItems((all) => all),
    body: cartJson({ id: "paypal-cart-id-sent-for-create", items: "{{updated_items}}", payment: PAY_CREATE }),
  });
  it("Cart created successfully", () => {
    expect([200, 201]).toContain(res().status);
    vars.multi_item_subtotals = res().body.totals.subtotal.value;
  });
  it("has all three items", () => expect(res().body.items).toHaveLength(3));
  collectionTests(res);
});

describe("Cart Operations / Multi Item Flow / Remove Items", () => {
  const res = send({
    method: "PUT",
    path: "/merchant-cart/{{cart_id}}",
    collection: true,
    prerequest: () => setUpdatedItems((all) => [all[2]]),
    body: cartJson({ id: "{{cart_id}}", items: "{{updated_items}}", options: true, payment: PAY_UPDATE }),
  });
  it("Cart updated successfully", () => expect(res().status).toBe(200));
  it("There should be only 1 item in the cart after update", () => {
    expect(res().body.items).toHaveLength(1);
    expect(Number(res().body.totals.subtotal.value)).toBeLessThan(Number(vars.multi_item_subtotals));
    vars.multi_item_subtotals = res().body.totals.subtotal.value;
  });
  collectionTests(res);
});

describe("Cart Operations / Multi Item Flow / Add Item", () => {
  const res = send({
    method: "PUT",
    path: "/merchant-cart/{{cart_id}}",
    collection: true,
    prerequest: () => setUpdatedItems((all) => [all[0], all[2]]),
    body: cartJson({ id: "{{cart_id}}", items: "{{updated_items}}", options: true, payment: PAY_UPDATE }),
  });
  it("Cart updated successfully", () => expect(res().status).toBe(200));
  it("There should be only 2 items in the cart after update", () => {
    expect(res().body.items).toHaveLength(2);
    expect(Number(res().body.totals.subtotal.value)).toBeGreaterThan(Number(vars.multi_item_subtotals));
    vars.multi_item_subtotals = res().body.totals.subtotal.value;
  });
  collectionTests(res);
});

describe("Cart Operations / Multi Item Flow / Checkout", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart/{{cart_id}}/checkout",
    collection: true,
    prerequest: buyerApproves,
    body: cartJson({ id: "{{cart_id}}", items: "{{updated_items}}", options: true, payment: PAY_CHECKOUT }),
  });
  it("Checkout completed successfully", () => expect([200, 201]).toContain(res().status));
  it("Order was created", () => expect(res().body.status).toBe("COMPLETED"));
  it("Order Id and Confirmation Page sent back", () => {
    const pc = res().body.payment_confirmation;
    expect(pc.merchant_order_number.length).toBeGreaterThanOrEqual(1);
    expect(pc.order_review_page).toMatch(/^https?:\/\//);
  });
  expectPayPalOrderMatchesCart(res);
  collectionTests(res, { checkout: true });
});

// ---------------------------------------------------------------------------
// Cart Operations (main flow)

describe("Cart Operations / Create Cart", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart",
    collection: true,
    body: cartJson({ id: "paypal-cart-id-sent-for-create", items: oneItem("1"), payment: PAY_CREATE }),
  });
  it("Cart created successfully", () => {
    expect([200, 201]).toContain(res().status);
    vars.quantity1_subtotals = res().body.totals.subtotal.value;
  });
  it("is created as a valid cart with a PayPal order (201)", () => {
    expect(res().status).toBe(201);
    expect(res().body.payment_method.token).toBeTruthy();
  });
  collectionTests(res);
});

describe("Cart Operations / Update Shipping Address", () => {
  const res = send({
    method: "PUT",
    path: "/merchant-cart/{{cart_id}}",
    collection: true,
    body: cartJson({ id: "{{cart_id}}", items: oneItem("{{item_quantity}}"), shipping: NEW_YORK, options: true, payment: PAY_UPDATE }),
  });
  it("Cart updated successfully", () => expect(res().status).toBe(200));
  it("Shipping address was updated", () => {
    expect(res().body.shipping_address).toMatchObject({
      address_line_1: "117 Barrow St",
      admin_area_2: "New York",
      admin_area_1: "NY",
      postal_code: "10014",
      country_code: "US",
    });
  });
  collectionTests(res);
});

describe("Cart Operations / Update Shipping Option", () => {
  const res = send({
    method: "PUT",
    path: "/merchant-cart/{{cart_id}}",
    collection: true,
    prerequest: () => {
      const current = JSON.parse(vars.available_shipping_options!) as Array<{ id: string; is_selected: boolean }>;
      if (current.length > 1) {
        const firstFalse = current.findIndex((o) => o.is_selected === false);
        const selected = current.findIndex((o) => o.is_selected === true);
        if (firstFalse !== -1 && selected !== -1) {
          vars.new_shipping_option_id = current[firstFalse]!.id;
          vars.old_shipping_option_id = current[selected]!.id;
          const next = structuredClone(current);
          next[firstFalse]!.is_selected = true;
          next[selected]!.is_selected = false;
          vars.available_shipping_options = JSON.stringify(next);
        }
      }
    },
    body: cartJson({ id: "{{cart_id}}", items: oneItem("{{item_quantity}}"), shipping: NEW_YORK, options: true, payment: PAY_UPDATE }),
  });
  it("Cart updated successfully", () => expect(res().status).toBe(200));
  it("Shipping option was updated", () => {
    const opts = res().body.available_shipping_options;
    expect(opts.length).toBeGreaterThan(1);
    expect(opts.find((o: any) => o.is_selected === true).id).toBe(vars.new_shipping_option_id);
  });
  collectionTests(res);
});

describe("Cart Operations / Update Customer Info", () => {
  const res = send({
    method: "PUT",
    path: "/merchant-cart/{{cart_id}}",
    collection: true,
    body: cartJson({
      id: "{{cart_id}}",
      items: oneItem("{{item_quantity}}"),
      customer: JOHNNY,
      shipping: NEW_YORK,
      options: true,
      payment: PAY_UPDATE,
    }),
  });
  it("Cart updated successfully", () => expect(res().status).toBe(200));
  it("Customer info was updated", () => {
    expect(res().body.customer).toEqual({
      name: { given_name: "Johnny", surname: "Dohe" },
      email_address: "jdoe2-pp@paypal.com",
      phone: { country_code: "1", national_number: "9087654321" },
    });
  });
  collectionTests(res);
});

describe("Cart Operations / Update Quantity", () => {
  const res = send({
    method: "PUT",
    path: "/merchant-cart/{{cart_id}}",
    collection: true,
    body: cartJson({ id: "{{cart_id}}", items: oneItem("2"), options: true, payment: PAY_UPDATE }),
  });
  it("Cart updated successfully", () => expect(res().status).toBe(200));
  it("Subtotal increased proportionately with quantity", () => {
    expect(Number(res().body.totals.subtotal.value)).toBeGreaterThanOrEqual(2 * Number(vars.quantity1_subtotals));
  });
  collectionTests(res);
});

describe("Cart Operations / Checkout", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart/{{cart_id}}/checkout",
    collection: true,
    prerequest: buyerApproves,
    body: cartJson({ id: "{{cart_id}}", items: oneItem("{{item_quantity}}"), options: true, payment: PAY_CHECKOUT }),
  });
  it("Checkout completed successfully", () => expect([200, 201]).toContain(res().status));
  it("Order was created", () => expect(res().body.status).toBe("COMPLETED"));
  it("Order Id and Confirmation Page sent back", () => {
    const pc = res().body.payment_confirmation;
    expect(pc.merchant_order_number.length).toBeGreaterThanOrEqual(1);
    expect(pc.order_review_page).toMatch(/^https?:\/\//);
  });
  it("keeps the shipping option chosen earlier in the flow", () => {
    expect(res().body.available_shipping_options.find((o: any) => o.is_selected).id).toBe(vars.new_shipping_option_id);
  });
  it("reports the payer", () => expect(res().body.payment_method.payer_id).toBe(vars.payer_id));
  expectPayPalOrderMatchesCart(res);
  collectionTests(res, { checkout: true });
});

// ---------------------------------------------------------------------------
// Common Error Scenarios (collection-level tests are skipped for these)

describe("Common Error Scenarios / ITEM_NOT_FOUND", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart",
    collection: false,
    body: cartJson({
      id: "paypal-cart-id-sent-for-create",
      items: `[{"parent_id":"INVALID_PARENT_ID_12345","variant_id":"INVALID_VARIANT_ID_12345","quantity":1}]`,
      payment: PAY_CREATE,
    }),
  });
  errorFolderTests("ITEM_NOT_FOUND", res, 422);
  it("carries business_context at the top level and on each detail", () => {
    expect(res().body.business_context.context.specific_issue).toBe("ITEM_NOT_FOUND");
    expect(res().body.details[0].business_context.variant_id).toBe("INVALID_VARIANT_ID_12345");
  });
});

describe("Common Error Scenarios / ITEM_OUT_OF_STOCK", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart",
    collection: false,
    body: cartJson({
      id: "paypal-cart-id-sent-for-create",
      items: oneItem("1", "out_of_stock_item_parent_id", "out_of_stock_item_variant_id"),
      payment: PAY_CREATE,
    }),
  });
  errorFolderTests("ITEM_OUT_OF_STOCK", res, 200);
  it("marks the cart INCOMPLETE / INVALID", () => {
    expect(res().body.status).toBe("INCOMPLETE");
    expect(res().body.validation_status).toBe("INVALID");
  });
});

describe("Common Error Scenarios / PAYMENT_DECLINED", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart/{{cart_id}}/checkout",
    collection: false,
    body: cartJson({
      id: "{{cart_id}}",
      items: oneItem("{{item_quantity}}"),
      payment: `{"type":"paypal","token":"INVALID_TOKEN_12345","payer_id":"{{payer_id}}"}`,
    }),
  });
  it("targets the main-flow cart, which is already completed", async () => {
    expect((await deps.carts.get(SHOP, vars.cart_id!))!.status).toBe("COMPLETED");
  });
  errorFolderTests("PAYMENT_DECLINED", res, 422);
});

describe("Common Error Scenarios / SHIPPING_NOT_AVAILABLE", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart",
    collection: false,
    body: cartJson({ id: "paypal-cart-id-sent-for-create", items: oneItem("1"), shipping: SYDNEY, payment: PAY_CREATE }),
  });
  // Neither accepted code exists in any 1.4.0 enum; we stay schema-valid instead.
  errorFolderTests("SHIPPING_NOT_AVAILABLE", res, 200, { codesUnpassable: true });
  it("reports the schema's INTERNATIONAL_SHIPPING_RESTRICTED instead", () => {
    expect(findErrorIssue(res().body, "INTERNATIONAL_SHIPPING_RESTRICTED")).toBe(true);
  });
});

describe("Common Error Scenarios / INVALID_JWT_TOKEN", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart",
    collection: false,
    authorization: "Bearer {{vault:json-web-token}}",
    body: cartJson({ id: "paypal-cart-id-sent-for-create", items: oneItem("1"), payment: PAY_CREATE }),
  });
  it("Cart created successfully (expects 401)", () => expect(res().status).toBe(401));
  it("Error response has expected structure", () => {
    expect(res().body.name).toBeTruthy();
    expect(res().body.message).toBeTruthy();
  });

  const archived = send({
    method: "POST",
    path: "/merchant-cart",
    collection: false,
    // The archived collection's hard-coded HS256 token with iss paypal.com.
    authorization:
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJsYXNlcnRlY2hub2xvZ2llcy5jb20iLCJzdWIiOiIxMjMiLCJpc3MiOiJwYXlwYWwuY29tIn0.c2lnbmF0dXJlLW5vdC1jaGVja2Vk",
    body: cartJson({ id: "paypal-cart-id-sent-for-create", items: oneItem("1"), payment: PAY_CREATE }),
  });
  it("rejects the archived HS256 token the same way", () => {
    expect(archived().status).toBe(401);
    expect(archived().body.name).toBeTruthy();
    expect(archived().body.message).toBeTruthy();
  });
});

describe("Common Error Scenarios / MULTI_ITEM_ERRORS", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart",
    collection: false,
    body: cartJson({
      id: "paypal-cart-id-sent-for-create",
      items: `[
        {"parent_id":"{{item_parent_id}}","variant_id":"{{item_variant_id}}","quantity":1},
        {"parent_id":"{{out_of_stock_item_parent_id}}","variant_id":"{{out_of_stock_item_variant_id}}","quantity":1},
        {"parent_id":"FAKE_PARENT_ID_99999","variant_id":"FAKE_VARIANT_ID_99999","quantity":1}
      ]`,
      payment: PAY_CREATE,
    }),
  });
  errorFolderTests("MULTI_ITEM_ERRORS", res, 200);
  const issues = () => res().body.validation_issues as any[];
  it("200 INCOMPLETE response has correct status flags", () => {
    expect(res().body.status).toBe("INCOMPLETE");
    expect(res().body.validation_status).toBe("INVALID");
  });
  it("validation_issues has multiple entries", () => expect(issues().length).toBeGreaterThanOrEqual(2));
  it("Each validation_issue has required code and type", () => {
    for (const i of issues()) {
      expect(typeof i.code).toBe("string");
      expect(typeof i.type).toBe("string");
    }
  });
  it("Each validation_issue has context with specific_issue", () => {
    for (const i of issues()) expect(typeof i.context.specific_issue).toBe("string");
  });
  it("Each validation_issue has variant_id to identify affected item", () => {
    for (const i of issues()) expect(typeof i.variant_id).toBe("string");
  });
  it("validation_issue variant_ids match items in cart", () => {
    const ids = res().body.items.map((i: any) => i.variant_id);
    for (const i of issues()) expect(ids).toContain(i.variant_id);
  });
  it("Multiple unique variant_ids affected", () => {
    expect(new Set(issues().map((i) => i.variant_id)).size).toBeGreaterThanOrEqual(2);
  });
  it("resolution_options have action and label (if present)", () => {
    for (const i of issues()) {
      for (const o of i.resolution_options ?? []) {
        expect(typeof o.action).toBe("string");
        expect(typeof o.label).toBe("string");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Edge Case Scenarios

describe("Edge Case Scenarios / Oregon Zero Sales Tax", () => {
  const res = send({
    method: "POST",
    path: "/merchant-cart",
    collection: true,
    body: cartJson({
      id: "paypal-cart-id-sent-for-create",
      items: oneItem("1", "parent_id", "variant_id"),
      shipping: PORTLAND,
      payment: PAY_CREATE,
    }),
  });
  it("Cart created successfully", () => expect([200, 201]).toContain(res().status));
  it("Oregon should have zero sales tax", () => {
    expect(res().body.totals.tax.value).toBeDefined();
    expect(Number(res().body.totals.tax.value)).toBe(0);
  });
  collectionTests(res);
});
