/** Builds the playground buyer agent's task from the conversation and the ids it already holds. */

export type Turn = { from: "user" | "agent"; text: string };

export const MAX_TURN_CHARS = 1200;

/** Ids the page read from earlier tool results, so a follow-up continues the same cart. */
export interface OpenState {
  cart?: { shop: string; cart_id: string };
  offer?: { shop: string; offer_id: string; expires_at: string };
}

const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CART_RE = /^CART-[A-Z0-9]{6,24}$/;
const OFFER_RE = /^OFF-[A-Z0-9]{8}$/;

export function openStateFrom(raw: unknown): OpenState {
  const out: OpenState = {};
  if (!raw || typeof raw !== "object") return out;
  const { cart, offer } = raw as { cart?: Record<string, unknown>; offer?: Record<string, unknown> };
  if (cart && typeof cart.shop === "string" && typeof cart.cart_id === "string" && SHOP_RE.test(cart.shop) && CART_RE.test(cart.cart_id)) {
    out.cart = { shop: cart.shop, cart_id: cart.cart_id };
  }
  if (
    offer &&
    typeof offer.shop === "string" &&
    typeof offer.offer_id === "string" &&
    typeof offer.expires_at === "string" &&
    SHOP_RE.test(offer.shop) &&
    OFFER_RE.test(offer.offer_id) &&
    Number.isFinite(Date.parse(offer.expires_at))
  ) {
    out.offer = { shop: offer.shop, offer_id: offer.offer_id, expires_at: new Date(offer.expires_at).toISOString() };
  }
  return out;
}

export function stateNote(state: OpenState, now: Date = new Date()): string {
  const lines: string[] = [];
  if (state.cart) {
    lines.push(
      `- Cart ${state.cart.cart_id} at ${state.cart.shop} is open and not ordered yet. Continue with it ` +
        "(update_cart to change it, checkout to finish it); don't create another cart for the same items.",
    );
  }
  if (state.offer && Date.parse(state.offer.expires_at) > now.getTime()) {
    lines.push(
      `- ${state.offer.shop} offered a deal, offer_id ${state.offer.offer_id}, valid until ${state.offer.expires_at}. ` +
        "Pass it as offer_id when you create or update the cart for those items.",
    );
  }
  return lines.length ? `Open from earlier in this conversation (ids from your own tool results):\n${lines.join("\n")}` : "";
}

export function taskFrom(history: Turn[], message: string, state: OpenState = {}): string {
  const earlier = history
    .slice(-8)
    .map((t) => `${t.from === "user" ? "Person" : "You"}: ${t.text.slice(0, MAX_TURN_CHARS)}`)
    .join("\n");
  const note = stateNote(state);
  if (!earlier && !note) return message;
  return [earlier ? `Conversation so far:\n${earlier}` : "", note, `Person: ${message}`].filter(Boolean).join("\n\n");
}
