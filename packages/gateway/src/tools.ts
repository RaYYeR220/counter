import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Customer, PayPalCart, ShippingOption, ValidationIssue } from "@counter/store-sync";
import type { ShopDirectory } from "./catalog-reader";
import type { StoreSyncClient, StoreSyncResponse } from "./client";
import type { OrderLookup } from "./payments-view";
import { cartText, cartView, issueLines, totalsLine, usd, type CartView, type StoreCart } from "./views";

export interface CounterToolDeps {
  directory: ShopDirectory;
  storeSync: StoreSyncClient;
  orders: OrderLookup;
  /** Buyer details used when the agent does not pass a customer. */
  defaultCustomer?: Customer;
  /** Public origin of the Counter app, e.g. https://counter.example. */
  publicBaseUrl: string;
  /** The shop's seller agent. When present, the `negotiate` tool is offered. */
  negotiator?: Negotiator;
}

/** One round of haggling with a shop's seller agent. Pricing rules are enforced on the shop's side. */
export interface Negotiator {
  haggle(req: {
    shop: string;
    items: Array<{ variant_id: string; quantity: number }>;
    message: string;
    history?: Array<{ from: "buyer" | "seller"; text: string }>;
  }): Promise<{
    reply: string;
    verdict: "accept" | "clamped" | "refuse" | "none";
    offer?: {
      offer_id: string;
      lines: Array<{ variant_id: string; quantity: number; unit_price: string; list_price: string }>;
      discount: string;
      expires_at: string;
    };
    unknown_items?: string[];
  }>;
}

export const TOOL_NAMES = [
  "list_shops",
  "search_products",
  "get_product",
  "create_cart",
  "update_cart",
  "checkout",
  "order_status",
] as const;

/** Server instructions to pair with these tools. */
export const COUNTER_INSTRUCTIONS =
  "Counter lets you buy from small independent shops on the user's behalf. Find products with search_products " +
  "or get_product, build a cart with create_cart, adjust it with update_cart, and finish with checkout. The user " +
  "pays with PayPal and approves every payment themselves. Only buy exactly what the user asked for.";

const BUYING_RULES =
  "Buying rules: only buy a variant whose attributes exactly match what the user asked for (size, colour or glaze, " +
  "roast, grind, weight, pack size, quantity). A near match (another size or colour, a 'seconds' piece, decaf " +
  "instead of regular, a made-to-order lead time) is a different product: offer it to the user, never buy it " +
  "silently. If nothing matches, or the matching variant is out of stock or not purchasable, tell the user " +
  "instead of buying.";

// ---------------------------------------------------------------------------
// Input schemas

const shopArg = z.string().min(1).max(100).describe("Shop slug from list_shops, e.g. juniper-clay");
const cartIdArg = z.string().min(1).max(100).describe("cart_id returned by create_cart");

const itemsArg = z
  .array(
    z.strictObject({
      variant_id: z.string().min(1).max(127).describe("Exact variant_id from search_products or get_product"),
      quantity: z.number().int().min(1).max(999).describe("How many units"),
    }),
  )
  .min(1)
  .max(50);

const addressArg = z.strictObject({
  address_line_1: z.string().min(1).max(300).describe("Street address"),
  address_line_2: z.string().max(300).optional().describe("Apartment, suite, unit"),
  admin_area_2: z.string().min(1).max(120).describe("City"),
  admin_area_1: z.string().min(2).max(300).describe("State as a two-letter code, e.g. CA"),
  postal_code: z.string().min(1).max(60).describe("ZIP code"),
  country_code: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .describe("Two-letter country code. Shops ship to US addresses only."),
});

const customerArg = z.strictObject({
  name: z.strictObject({
    given_name: z.string().min(1).max(140),
    surname: z.string().min(1).max(140),
  }),
  email_address: z.email().max(254).optional(),
  phone: z
    .strictObject({
      country_code: z.string().regex(/^\d{1,3}$/).describe("Calling code without +, e.g. 1"),
      national_number: z.string().regex(/^\d{1,14}$/),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Results

type Structured = Record<string, unknown>;

function ok(text: string, data: object): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: data as Structured };
}

function fail(text: string, error: Structured): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: { error }, isError: true };
}

interface ErrorLike {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: Array<{ field?: string; issue?: string; description?: string; business_context?: ValidationIssue }>;
  business_context?: ValidationIssue;
}

/** A non-success Store Sync response as a tool error, keeping the shop's issues verbatim. */
function shopError(res: StoreSyncResponse, what: string): CallToolResult {
  const b: ErrorLike = typeof res.body === "object" && res.body !== null ? (res.body as ErrorLike) : {};
  const fromDetails = (b.details ?? []).map((d) => d.business_context).filter((c): c is ValidationIssue => !!c);
  const issues = fromDetails.length ? fromDetails : b.business_context ? [b.business_context] : [];
  const name = b.name ?? `HTTP_${res.status}`;
  const message = b.message ?? (typeof res.body === "string" && res.body ? res.body.slice(0, 300) : "Request failed");
  const details = (b.details ?? []).map(({ field, issue, description }) => ({ field, issue, description }));
  const lines = [`${what} failed (${res.status} ${name}): ${message}`];
  if (issues.length) lines.push(...issueLines(issues));
  else for (const d of details) if (d.description) lines.push(`- ${d.field ?? ""} ${d.description}`.trim());
  return fail(lines.join("\n"), {
    status: res.status,
    name,
    message,
    ...(b.debug_id ? { debug_id: b.debug_id } : {}),
    ...(details.length ? { details } : {}),
    ...(issues.length ? { issues } : {}),
  });
}

function unreachable(what: string, shop: string, err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return fail(`${what} at shop '${shop}' failed: ${message}`, { status: 0, name: "SHOP_UNREACHABLE", message });
}

async function guard(what: string, shop: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return unreachable(what, shop, err);
  }
}

// ---------------------------------------------------------------------------
// Cart plumbing

/**
 * The request body PayPal's platform sends for a stored cart: the buyer-side
 * fields, the shop's shipping options with the current selection, and the
 * payment token. Server-computed fields (totals, status, issues) are left out.
 */
export function requestCart(c: PayPalCart): PayPalCart {
  const token = c.payment_method?.token;
  return {
    ...(c.id ? { id: c.id } : {}),
    items: (c.items ?? []).map((i) => ({
      ...(i.parent_id ? { parent_id: i.parent_id } : {}),
      ...(i.variant_id ? { variant_id: i.variant_id } : {}),
      quantity: i.quantity,
    })),
    ...(c.customer ? { customer: c.customer } : {}),
    ...(c.shipping_address ? { shipping_address: c.shipping_address } : {}),
    ...(c.billing_address ? { billing_address: c.billing_address } : {}),
    ...(c.available_shipping_options?.length ? { available_shipping_options: c.available_shipping_options } : {}),
    payment_method: token ? { type: "paypal", token } : { type: "paypal" },
    ...(c.discounts?.codes?.length ? { discounts: { codes: c.discounts.codes } } : {}),
    ...(c.checkout_fields ? { checkout_fields: c.checkout_fields } : {}),
    ...(c.marketing_consents ? { marketing_consents: c.marketing_consents } : {}),
    ...(c.geo_coordinates ? { geo_coordinates: c.geo_coordinates } : {}),
  };
}

function selectShipping(options: readonly ShippingOption[], id: string): ShippingOption[] {
  const out = options.map((o) => ({ ...o, is_selected: o.id === id }));
  if (!out.some((o) => o.is_selected)) {
    // Not quoted yet (for example, the address changes in the same update): ask for it by id.
    out.push({ id, name: id, price: { currency_code: "USD", value: "0.00" }, is_selected: true });
  }
  return out;
}

async function loadCart(
  deps: CounterToolDeps,
  shop: string,
  cartId: string,
): Promise<{ cart: StoreCart } | { error: CallToolResult }> {
  const res = await deps.storeSync.get(shop, cartId);
  if (res.status !== 200) return { error: shopError(res, `Reading cart ${cartId}`) };
  return { cart: res.body as StoreCart };
}

function cartResult(shop: string, body: unknown, note?: string): CallToolResult {
  const view = cartView(shop, body as StoreCart);
  return ok(note ? `${cartText(view)}\nNote: ${note}` : cartText(view), view);
}

interface Confirmation {
  order_number: string;
  order_review_page: string;
}

function confirmationOf(body: unknown): Confirmation | undefined {
  const pc = (body as StoreCart | null)?.payment_confirmation;
  return pc ? { order_number: pc.merchant_order_number, order_review_page: pc.order_review_page } : undefined;
}

/** For a completed cart: the shop replays its checkout response (same token), which carries the order number. */
async function completedConfirmation(
  deps: CounterToolDeps,
  shop: string,
  cart: StoreCart,
): Promise<{ confirmation?: Confirmation; body: unknown }> {
  const token = cart.payment_method?.token;
  if (!token || !cart.id) return { body: cart };
  const res = await deps.storeSync.checkout(shop, cart.id, {
    token,
    ...(cart.payment_method?.payer_id ? { payerId: cart.payment_method.payer_id } : {}),
  });
  if (res.status !== 200) return { body: cart };
  const confirmation = confirmationOf(res.body);
  return { body: res.body, ...(confirmation ? { confirmation } : {}) };
}

export interface CheckoutOutcome {
  needs_approval: boolean;
  completed: boolean;
  approve_url?: string;
  order_number?: string;
  order_review_page?: string;
  paypal_order_id: string | null;
  message: string;
  cart: CartView;
}

function checkoutResult(o: CheckoutOutcome): CallToolResult {
  const lines = [o.message, totalsLine(o.cart)];
  if (o.approve_url && o.needs_approval) lines.push(`Approve: ${o.approve_url}`);
  if (o.order_number) lines.push(`Order ${o.order_number}: ${o.order_review_page}`);
  if (o.cart.validation_issues.length) lines.push("Issues:", ...issueLines(o.cart.validation_issues));
  return ok(lines.join("\n"), o);
}

function completedOutcome(shop: string, body: unknown, c: Confirmation, again = false): CheckoutOutcome {
  const cart = cartView(shop, body as StoreCart);
  return {
    needs_approval: false,
    completed: true,
    order_number: c.order_number,
    order_review_page: c.order_review_page,
    paypal_order_id: cart.paypal_order_id,
    message: `${again ? "Already ordered" : "Order placed"}: ${c.order_number} at ${shop}, total ${usd(cart.totals.total)}.`,
    cart,
  };
}

function needsChanges(shop: string, body: unknown): CheckoutOutcome {
  const cart = cartView(shop, body as StoreCart);
  return {
    needs_approval: false,
    completed: false,
    paypal_order_id: cart.paypal_order_id,
    message: `This cart cannot be checked out yet. ${cart.next_step}`,
    cart,
  };
}

// ---------------------------------------------------------------------------
// Registration

/** Registers Counter's shopping tools on an MCP server. */
export function registerCounterTools(server: McpServer, deps: CounterToolDeps): void {
  const base = deps.publicBaseUrl.replace(/\/+$/, "");

  server.registerTool(
    "list_shops",
    {
      title: "List shops",
      description:
        "List the independent shops you can buy from. Each entry has the shop slug (pass it as `shop` to the " +
        "other tools), what it sells, where it ships from and its returns window. Shops ship to US addresses " +
        "only and take payment through PayPal.",
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const shops = (await deps.directory.listShops()).map((s) => ({ ...s, url: `${base}/s/${s.shop}` }));
      const text = shops
        .map((s) => `${s.name} [${s.shop}]: ${s.tagline ?? ""} Sells ${s.categories.join(", ")}. Ships from ${s.location ?? "the US"}.`)
        .join("\n");
      return ok(text || "No shops are available.", { shops });
    },
  );

  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description:
        "Search the shops' catalogs. Each result is one exact variant (variant_id) with its attributes, unit " +
        "price in USD, stock and flags (seconds = cosmetic flaw at a lower price, made_to_order, " +
        "subscription_only, decaf, limited). Results are ranked by match; out of stock variants are included " +
        "with in_stock=false, never hidden, and variants with purchasable=false cannot be bought. Leave `shop` " +
        "out to search every shop; an empty query with a shop lists its catalog. Use get_product for every " +
        `variant of a product and delivery dates. ${BUYING_RULES}`,
      inputSchema: z.strictObject({
        query: z.string().max(200).describe("What the user wants, e.g. 'green speckled mug 12 oz'"),
        shop: shopArg.optional(),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum results, default 10"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, shop, limit }) => {
      const results = await deps.directory.search({
        query,
        ...(shop ? { shop } : {}),
        ...(limit ? { limit } : {}),
      });
      if (!results.length) {
        return ok(`No products match "${query}"${shop ? ` at ${shop}` : ""}. Tell the user nothing matches.`, {
          query,
          results,
        });
      }
      const text = results
        .map(
          (h) =>
            `${h.variant_id} [${h.shop}] ${h.name}: ${usd(h.price)}, ${h.availability}` +
            (h.flags.length ? ` (flags: ${h.flags.join(", ")})` : ""),
        )
        .join("\n");
      return ok(text, { query, results });
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product",
      description:
        "Full details of one product: description and every variant with variant_id, attributes, price, " +
        "stock (in_stock), purchasable, flags, lead_time_days and estimated delivery dates for STANDARD and " +
        "EXPRESS shipping to a US address if ordered today. Use it to confirm the exact variant before " +
        "creating a cart.",
      inputSchema: z.strictObject({
        shop: shopArg,
        parent_id: z.string().min(1).max(127).describe("parent_id from search_products"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ shop, parent_id }) => {
      const p = await deps.directory.getProduct(shop, parent_id);
      if (!p) {
        return fail(`No product ${parent_id} at shop '${shop}'. Use search_products to find it.`, {
          status: 404,
          name: "PRODUCT_NOT_FOUND",
          message: `No product ${parent_id} at shop '${shop}'`,
        });
      }
      const lines = [`${p.name} [${p.parent_id}] at ${p.shop_name}`];
      if (p.description) lines.push(p.description);
      for (const v of p.variants) {
        const ship = v.delivery.map((d) => `${d.id} ${usd(d.price)} est. ${d.estimated_delivery}`).join(", ");
        lines.push(
          `- ${v.variant_id} ${Object.values(v.attributes).join(", ")}: ${usd(v.price)}, ${v.availability}` +
            (v.flags.length ? ` (flags: ${v.flags.join(", ")})` : "") +
            (ship ? `; ${ship}` : ""),
        );
      }
      return ok(lines.join("\n"), p);
    },
  );

  server.registerTool(
    "create_cart",
    {
      title: "Create cart",
      description:
        "Create a cart at one shop with exact variants and quantities. The shop prices it (never send prices), " +
        "checks stock, quotes shipping to the address, adds sales tax and opens a PayPal order for the total. " +
        "Returns cart_id, line items, shipping options, totals and the PayPal order id. If validation_issues " +
        "come back, explain each user_message to the user and fix the cart with update_cart using one of the " +
        `resolution_options. ${BUYING_RULES}`,
      inputSchema: z.strictObject({
        shop: shopArg,
        items: itemsArg.describe("The exact variants the user asked for"),
        shipping_address: addressArg,
        customer: customerArg.optional().describe("The buyer; defaults to the account's buyer details"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ shop, items, shipping_address, customer }) =>
      guard("Creating a cart", shop, async () => {
        const buyer = customer ?? deps.defaultCustomer;
        const cart: PayPalCart = {
          items: items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity })),
          ...(buyer ? { customer: buyer } : {}),
          shipping_address,
          payment_method: { type: "paypal" },
        };
        const res = await deps.storeSync.create(shop, cart);
        if (res.status !== 200 && res.status !== 201) return shopError(res, "Creating the cart");
        return cartResult(shop, res.body);
      }),
  );

  server.registerTool(
    "update_cart",
    {
      title: "Update cart",
      description:
        "Change a cart. Pass only what changes. `items` replaces the whole item list: include every line to " +
        "keep with its quantity and leave a line out to remove it. `shipping_address` replaces the address. " +
        "`shipping_option_id` picks one of the cart's shipping_options (STANDARD or EXPRESS). The shop receives " +
        "a full replacement of the cart, re-prices it and updates the PayPal order. The same buying rules as " +
        "create_cart apply.",
      inputSchema: z.strictObject({
        shop: shopArg,
        cart_id: cartIdArg,
        items: itemsArg.optional().describe("The complete new item list"),
        shipping_address: addressArg.optional(),
        shipping_option_id: z.string().min(1).max(40).optional().describe("STANDARD or EXPRESS"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ shop, cart_id, items, shipping_address, shipping_option_id }) =>
      guard("Updating the cart", shop, async () => {
        const loaded = await loadCart(deps, shop, cart_id);
        if ("error" in loaded) return loaded.error;
        const current = loaded.cart;
        if (current.status === "COMPLETED") {
          return fail(`Cart ${cart_id} is already ordered and can no longer change.`, {
            status: 409,
            name: "CART_COMPLETED",
            message: "The cart is already completed",
          });
        }
        if (!items && !shipping_address && !shipping_option_id) return cartResult(shop, current, "Nothing to change.");

        const next = requestCart(current);
        if (items) next.items = items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity }));
        if (shipping_address) next.shipping_address = shipping_address;
        if (shipping_option_id) {
          next.available_shipping_options = selectShipping(current.available_shipping_options ?? [], shipping_option_id);
        }
        const res = await deps.storeSync.replace(shop, cart_id, next);
        if (res.status !== 200) return shopError(res, "Updating the cart");

        const selected = (res.body as StoreCart).available_shipping_options?.find((o) => o.is_selected)?.id;
        const note =
          shipping_option_id && selected !== shipping_option_id
            ? `Shipping option ${shipping_option_id} is not offered for this cart; ${selected ?? "none"} is selected.`
            : undefined;
        return cartResult(shop, res.body, note);
      }),
  );

  server.registerTool(
    "checkout",
    {
      title: "Checkout",
      description:
        "Complete the purchase of a cart. The user pays with PayPal and must approve the payment themselves: " +
        "while the PayPal order is not approved this returns needs_approval=true and an approve_url. Give the " +
        "user that link, wait until they say they have approved, then call checkout again. Once approved, the " +
        "shop authorizes the payment and books the order, and you get an order_number and an order review " +
        "page. Only call checkout for a cart whose items, address and total the user has confirmed. Calling " +
        "it again after the order is placed returns the same order.",
      inputSchema: z.strictObject({ shop: shopArg, cart_id: cartIdArg }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ shop, cart_id }) =>
      guard("Checkout", shop, async () => {
        const loaded = await loadCart(deps, shop, cart_id);
        if ("error" in loaded) return loaded.error;
        const cart = loaded.cart;

        if (cart.status === "COMPLETED") {
          const done = await completedConfirmation(deps, shop, cart);
          if (done.confirmation) return checkoutResult(completedOutcome(shop, done.body, done.confirmation, true));
        }
        const view = cartView(shop, cart);
        const token = view.paypal_order_id;
        if (!view.ready_for_checkout || !token) return checkoutResult(needsChanges(shop, cart));

        const approval = await deps.orders.approvalState(shop, token);
        if (approval.status !== "APPROVED" && approval.status !== "COMPLETED") {
          const approveUrl = approval.approveUrl || cart.payment_method?.approval_url || "";
          return checkoutResult({
            needs_approval: true,
            completed: false,
            approve_url: approveUrl,
            paypal_order_id: token,
            message:
              "The user has not approved this payment yet. Ask them to open approve_url, log in to PayPal and " +
              "approve the payment, then call checkout again.",
            cart: view,
          });
        }

        const res = await deps.storeSync.checkout(shop, cart_id, {
          token,
          ...(approval.payerId ? { payerId: approval.payerId } : {}),
          cart: requestCart(cart),
        });
        if (res.status !== 200) return shopError(res, "Checkout");
        const confirmation = confirmationOf(res.body);
        if (!confirmation) return checkoutResult(needsChanges(shop, res.body));
        return checkoutResult(completedOutcome(shop, res.body, confirmation));
      }),
  );

  server.registerTool(
    "order_status",
    {
      title: "Order status",
      description:
        "Where a cart stands: the cart status, whether its PayPal payment is still awaiting the user's " +
        "approval (with the approve_url), approved and ready for checkout, or completed, and the order number " +
        "once the order is placed.",
      inputSchema: z.strictObject({ shop: shopArg, cart_id: cartIdArg }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ shop, cart_id }) =>
      guard("Looking up the order", shop, async () => {
        const loaded = await loadCart(deps, shop, cart_id);
        if ("error" in loaded) return loaded.error;
        const cart = loaded.cart;
        const view = cartView(shop, cart);
        const token = view.paypal_order_id;

        let status: Structured;
        if (cart.status === "COMPLETED") {
          const done = await completedConfirmation(deps, shop, cart);
          status = {
            payment_status: "COMPLETED",
            ...(done.confirmation ?? {}),
            message: done.confirmation
              ? `Order ${done.confirmation.order_number} is placed.`
              : "The order is placed; the shop did not return an order number.",
          };
        } else if (!token) {
          status = { payment_status: "NOT_STARTED", message: view.next_step };
        } else {
          const approval = await deps.orders.approvalState(shop, token);
          if (approval.status === "CREATED") {
            status = {
              payment_status: "AWAITING_APPROVAL",
              approve_url: approval.approveUrl,
              message: "Waiting for the user to approve the payment at approve_url.",
            };
          } else if (approval.status === "UNKNOWN") {
            status = { payment_status: "UNKNOWN", message: "PayPal does not report this payment; call checkout to retry." };
          } else {
            status = { payment_status: "APPROVED", message: "The user approved the payment: call checkout to place the order." };
          }
        }

        const out = { shop, cart_id, cart_status: view.status, paypal_order_id: token, ...status, cart: view };
        const lines = [`Cart ${cart_id} at ${shop}: ${view.status}, payment ${String(status.payment_status)}`, totalsLine(view)];
        if (typeof status.approve_url === "string") lines.push(`Approve: ${status.approve_url}`);
        if (typeof status.order_number === "string") lines.push(`Order ${status.order_number}: ${String(status.order_review_page)}`);
        lines.push(String(status.message));
        return ok(lines.join("\n"), out);
      }),
  );

  if (deps.negotiator) {
    const negotiator = deps.negotiator;
    server.registerTool(
      "negotiate",
      {
        title: "Ask the shop for a deal",
        description:
          "Ask the shop's seller agent for a better price on specific variants and quantities before you build the " +
          "cart, e.g. a bundle discount for three mugs. Send what the user would say. The shop answers in plain " +
          "words and, when it agrees to a deal, returns an offer: create_cart with exactly those variants and at " +
          "least those quantities before expires_at and the discount is applied automatically. The shop's pricing " +
          "rules are enforced on its side, so pushing harder does not change what is allowed. Only negotiate when " +
          "the user wants a deal; never trade away what the user asked for to get a discount.",
        inputSchema: z.strictObject({
          shop: shopArg,
          items: itemsArg,
          message: z.string().min(1).max(2000).describe("What the buyer asks for, in plain words"),
          history: z
            .array(z.strictObject({ from: z.enum(["buyer", "seller"]), text: z.string().max(2000) }))
            .max(20)
            .optional()
            .describe("Earlier turns of this negotiation, oldest first"),
        }),
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ shop, items, message, history }) => {
        try {
          const out = await negotiator.haggle({ shop, items, message, ...(history ? { history } : {}) });
          const lines = [`${shop} says: ${out.reply}`];
          if (out.offer) {
            const parts = out.offer.lines.map((l) => `${l.quantity} x ${l.variant_id} at ${usd(l.unit_price)} (list ${usd(l.list_price)})`);
            lines.push(`Offer ${out.offer.offer_id}: ${parts.join(", ")}; ${usd(out.offer.discount)} off; valid until ${out.offer.expires_at}.`);
            lines.push("Create the cart with these variants and quantities to use it.");
          } else {
            lines.push("No discount is on offer for this cart; list prices apply.");
          }
          if (out.unknown_items?.length) lines.push(`Not orderable here: ${out.unknown_items.join(", ")}.`);
          return ok(lines.join("\n"), { shop, ...out });
        } catch (e) {
          return fail(`The shop could not answer right now: ${(e as Error).message}`, { name: "NEGOTIATION_UNAVAILABLE" });
        }
      },
    );
  }
}
