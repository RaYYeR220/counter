import type { CartView, CheckoutOutcome, NegotiationView, Run } from "./types";

/** The cart and offer still open after the runs so far, read from the tools' own results. */
export interface PageOpenState {
  cart?: { shop: string; cart_id: string };
  offer?: { shop: string; offer_id: string; expires_at: string };
}

const CART_TOOLS = new Set(["create_cart", "update_cart"]);
const ORDER_TOOLS = new Set(["checkout", "order_status"]);

export function openStateOf(runs: readonly Run[]): PageOpenState {
  let cart: (PageOpenState["cart"] & { done: boolean }) | undefined;
  let offer: PageOpenState["offer"];
  for (const run of runs) {
    for (const step of [...run.steps].sort((a, b) => a.index - b.index)) {
      if (!step.ok || !step.structured || typeof step.structured !== "object") continue;
      if (CART_TOOLS.has(step.tool)) {
        const v = step.structured as CartView;
        if (v.cart_id && v.shop) cart = { shop: v.shop, cart_id: v.cart_id, done: v.status === "COMPLETED" };
      } else if (ORDER_TOOLS.has(step.tool)) {
        const o = step.structured as Partial<CheckoutOutcome> & { cart_status?: string; cart?: CartView };
        const v = o.cart;
        if (v?.cart_id && v.shop) {
          const done = o.completed === true || v.status === "COMPLETED" || o.cart_status === "COMPLETED";
          cart = { shop: v.shop, cart_id: v.cart_id, done };
          if (done && offer?.shop === v.shop) offer = undefined;
        }
      } else if (step.tool === "negotiate") {
        const n = step.structured as NegotiationView;
        if (n.offer?.offer_id) offer = { shop: n.shop, offer_id: n.offer.offer_id, expires_at: n.offer.expires_at };
      }
    }
  }
  const out: PageOpenState = {};
  if (cart && !cart.done) out.cart = { shop: cart.shop, cart_id: cart.cart_id };
  if (offer) out.offer = offer;
  return out;
}
