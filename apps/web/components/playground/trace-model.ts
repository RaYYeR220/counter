import type { CartView, CheckoutOutcome, StepView, ToolError } from "./types";

// Reading the buyer agent's tool calls back into what happened at the shop:
// which Store Sync request ran, what it answered, and what a failure means.

export function record(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

export const TOOL_LABELS: Record<string, string> = {
  list_shops: "List shops",
  search_products: "Search products",
  get_product: "Get product",
  negotiate: "Ask the shop for a deal",
  create_cart: "Create cart",
  update_cart: "Update cart",
  checkout: "Checkout",
  order_status: "Order status",
};

export function toolError(step: StepView): ToolError | null {
  if (step.ok) return null;
  const err = record(record(step.structured)?.error);
  return err ? (err as ToolError) : { message: step.text };
}

/** The tool's structured result, when the call succeeded. */
export function resultOf<T>(step: StepView): T | null {
  if (!step.ok) return null;
  const r = record(step.structured);
  return r && !("error" in r) ? (r as T) : null;
}

export interface HttpLine {
  method: "GET" | "POST" | "PUT";
  path: string;
  /** HTTP status, or a short word when the call never got an answer. */
  status: number | "no answer";
  name?: string;
}

const cartPath = (id: string | undefined) => `/merchant-cart/${id || "{id}"}`;

function argString(args: unknown, key: string): string | undefined {
  const v = record(args)?.[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * The Store Sync requests behind a cart tool call, as far as its result
 * proves them. A created cart answers 201 when it is valid and 200 when it
 * comes back incomplete; a failure carries the shop's own status and name.
 * Catalog reads and negotiation are not Store Sync calls and have none.
 */
export function httpLines(step: StepView): HttpLine[] {
  const err = toolError(step);
  const failed = (method: HttpLine["method"], path: string): HttpLine => ({
    method,
    path,
    status: err?.status ? err.status : "no answer",
    ...(err?.name ? { name: err.name } : {}),
  });
  const cartId = argString(step.args, "cart_id");

  switch (step.tool) {
    case "create_cart": {
      if (err) return [failed("POST", "/merchant-cart")];
      const cart = resultOf<CartView>(step);
      return [{ method: "POST", path: "/merchant-cart", status: cart?.status === "CREATED" ? 201 : 200 }];
    }
    case "update_cart": {
      const path = cartPath(cartId);
      if (err) {
        const readFailed = step.text.startsWith("Reading cart");
        return readFailed ? [failed("GET", path)] : [{ method: "GET", path, status: 200 }, failed("PUT", path)];
      }
      return [
        { method: "GET", path, status: 200 },
        { method: "PUT", path, status: 200 },
      ];
    }
    case "checkout": {
      const path = cartPath(cartId);
      if (err) {
        const readFailed = step.text.startsWith("Reading cart");
        return readFailed ? [failed("GET", path)] : [{ method: "GET", path, status: 200 }, failed("POST", `${path}/checkout`)];
      }
      const out = resultOf<CheckoutOutcome>(step);
      if (out?.completed) return [{ method: "POST", path: `${path}/checkout`, status: 200 }];
      return [{ method: "GET", path, status: 200 }];
    }
    case "order_status":
      return err ? [failed("GET", cartPath(cartId))] : [{ method: "GET", path: cartPath(cartId), status: 200 }];
    default:
      return [];
  }
}

/** A failed call in one plain sentence: what happened and what it means for the buyer. */
export function explainError(step: StepView, err: ToolError, paymentsConnected: boolean | undefined): string {
  switch (err.name) {
    case "PAYMENT_PROCESSOR_UNAVAILABLE":
      return paymentsConnected === false
        ? "Payments aren't connected on this deployment yet. The shop priced the cart, but no PayPal order could be opened, so nothing can be bought or charged."
        : "PayPal didn't answer the shop. No PayPal order was opened and nothing was charged.";
    case "SHOP_UNREACHABLE":
      return "The shop's Cart API didn't answer, so nothing changed.";
    case "NEGOTIATION_UNAVAILABLE":
      return "The shop's seller agent didn't answer. List prices still apply.";
    case "PRODUCT_NOT_FOUND":
      return "The shop has no product with that id.";
    case "CART_COMPLETED":
      return "That cart is already ordered and can't change.";
    case "ORDER_SYSTEM_ERROR":
      return "The shop couldn't record the order. Nothing was captured.";
    default:
      break;
  }
  if (err.issues?.length) return "The shop refused the cart as sent:";
  if (step.tool === "checkout" && err.status === 422) return "The shop declined the checkout.";
  return err.message || "The call failed.";
}

/** The arguments worth reading, as short label/value pairs. */
export function argSummary(step: StepView): Array<[string, string]> {
  const a = record(step.args);
  if (!a) return typeof step.args === "string" && step.args ? [["sent", step.args.slice(0, 160)]] : [];
  const out: Array<[string, string]> = [];
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  const items = Array.isArray(a.items)
    ? (a.items as unknown[])
        .map((i) => record(i))
        .filter((i): i is Record<string, unknown> => !!i)
        .map((i) => `${String(i.quantity ?? 1)} × ${String(i.variant_id ?? "?")}`)
        .join(", ")
    : undefined;
  switch (step.tool) {
    case "search_products":
      out.push(["query", str("query") ? `“${str("query")}”` : "everything"]);
      if (str("shop")) out.push(["shop", str("shop")!]);
      break;
    case "get_product":
      if (str("shop")) out.push(["shop", str("shop")!]);
      if (str("parent_id")) out.push(["product", str("parent_id")!]);
      break;
    case "negotiate":
      if (str("shop")) out.push(["shop", str("shop")!]);
      if (items) out.push(["items", items]);
      if (str("message")) out.push(["asked", `“${str("message")}”`]);
      break;
    case "create_cart": {
      if (str("shop")) out.push(["shop", str("shop")!]);
      if (items) out.push(["items", items]);
      const addr = record(a.shipping_address);
      if (addr) out.push(["ship to", [addr.admin_area_2, addr.admin_area_1, addr.postal_code].filter(Boolean).join(", ")]);
      break;
    }
    case "update_cart":
      if (str("cart_id")) out.push(["cart", str("cart_id")!]);
      if (items) out.push(["items", items]);
      if (str("shipping_option_id")) out.push(["shipping", str("shipping_option_id")!]);
      if (record(a.shipping_address)) out.push(["address", "changed"]);
      break;
    case "checkout":
    case "order_status":
      if (str("shop")) out.push(["shop", str("shop")!]);
      if (str("cart_id")) out.push(["cart", str("cart_id")!]);
      break;
    default:
      break;
  }
  return out;
}

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$34.00" from a two-decimal amount string. */
export function usd(v: string | number | undefined | null): string {
  if (v == null || v === "") return "–";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? usdFormat.format(n) : String(v);
}

export function msLabel(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(0)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** The checkout result that is still waiting for the buyer's approval, latest first. */
export function pendingApproval(steps: StepView[]): CheckoutOutcome | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.tool !== "checkout") continue;
    const out = resultOf<CheckoutOutcome>(s);
    if (out?.completed) return null;
    if (out?.needs_approval && out.approve_url) return out;
  }
  return null;
}

/** True when a call in the run hit the unconnected PayPal rail. */
export function hitUnconnectedPayments(steps: StepView[]): boolean {
  return steps.some((s) => toolError(s)?.name === "PAYMENT_PROCESSOR_UNAVAILABLE");
}
