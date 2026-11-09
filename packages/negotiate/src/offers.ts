import type { AppliedDiscountIn, DiscountPort, PayPalCart } from "@counter/store-sync";
import type { DealLine } from "./engine";

/** A deal the engine approved, held for one agent client at one shop until it expires. */
export interface Offer {
  /** `OFF-` followed by 8 characters from [A-Z0-9]. Also the discount code on the cart. */
  id: string;
  shopId: string;
  agentClient: string;
  lines: DealLine[];
  discountCents: number;
  createdAt: Date;
  expiresAt: Date;
}

/** The part of an engine evaluation an offer is made from. */
export interface OfferDeal {
  lines: DealLine[];
  discountCents: number;
}

export interface CartLineRef {
  variantId: string;
  quantity: number;
}

/** Where offers live. In memory here; a database table later. */
export interface OfferStore {
  save(offer: Offer): Promise<void>;
  /** Every offer for this agent client at this shop, expired or not. */
  forAgent(shopId: string, agentClient: string): Promise<Offer[]>;
}

const copy = (o: Offer): Offer => ({
  ...o,
  lines: o.lines.map((l) => ({ ...l })),
  createdAt: new Date(o.createdAt),
  expiresAt: new Date(o.expiresAt),
});

export class MemoryOfferStore implements OfferStore {
  private readonly rows: Offer[] = [];

  async save(offer: Offer): Promise<void> {
    this.rows.push(copy(offer));
  }

  async forAgent(shopId: string, agentClient: string): Promise<Offer[]> {
    return this.rows.filter((o) => o.shopId === shopId && o.agentClient === agentClient).map(copy);
  }
}

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function newOfferId(): string {
  let id = "";
  while (id.length < 8) {
    // 252 is the largest multiple of 36 below 256; bytes above it are skipped to avoid bias.
    for (const b of crypto.getRandomValues(new Uint8Array(8))) {
      if (b < 252 && id.length < 8) id += ID_ALPHABET[b % 36];
    }
  }
  return `OFF-${id}`;
}

function lineDiscount(l: DealLine): number {
  return (l.listCents - l.unitCents) * l.quantity;
}

/**
 * Issues offers for approved deals and turns them into cart discounts.
 *
 * An offer applies to a cart only while it is unexpired, for the agent client
 * it was issued to, and when the cart holds every offered line in at least
 * the offered quantity. Only the offered lines and quantities are discounted;
 * anything else in the cart stays at list. A cart gets at most one offer: the
 * largest one that matches.
 */
export class OfferBook {
  private readonly store: OfferStore;
  private readonly newId: () => string;

  constructor(opts: { store?: OfferStore; newId?: () => string } = {}) {
    this.store = opts.store ?? new MemoryOfferStore();
    this.newId = opts.newId ?? newOfferId;
  }

  async issue(shopId: string, agentClient: string, deal: OfferDeal, ttlMs: number, now: Date = new Date()): Promise<Offer> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("An offer needs a positive lifetime");
    if (!(deal.discountCents > 0)) throw new RangeError("An offer needs a discount");
    for (const l of deal.lines) {
      if (!Number.isSafeInteger(l.unitCents) || l.unitCents > l.listCents || !Number.isSafeInteger(l.quantity) || l.quantity <= 0) {
        throw new RangeError(`Offer line ${l.variantId} is malformed`);
      }
    }
    if (deal.lines.reduce((s, l) => s + lineDiscount(l), 0) !== deal.discountCents) {
      throw new RangeError("Offer discount does not match its lines");
    }
    const offer: Offer = {
      id: this.newId(),
      shopId,
      agentClient,
      lines: deal.lines.map((l) => ({ ...l })),
      discountCents: deal.discountCents,
      createdAt: new Date(now),
      expiresAt: new Date(now.getTime() + ttlMs),
    };
    await this.store.save(offer);
    return copy(offer);
  }

  async discountsFor(
    shopId: string,
    agentClient: string,
    cartLines: readonly CartLineRef[],
    now: Date,
  ): Promise<AppliedDiscountIn[]> {
    const inCart = new Map<string, number>();
    for (const l of cartLines) inCart.set(l.variantId, (inCart.get(l.variantId) ?? 0) + l.quantity);

    let best: Offer | undefined;
    for (const o of await this.store.forAgent(shopId, agentClient)) {
      const usable =
        o.shopId === shopId &&
        o.agentClient === agentClient &&
        now.getTime() < o.expiresAt.getTime() &&
        o.lines.every((l) => (inCart.get(l.variantId) ?? 0) >= l.quantity);
      if (usable && (!best || o.discountCents > best.discountCents)) best = o;
    }
    if (!best) return [];
    const code = best.id;
    return best.lines
      .filter((l) => lineDiscount(l) > 0)
      .map((l) => ({ code, variantId: l.variantId, amountCents: lineDiscount(l), description: "Negotiated price" }));
  }
}

/** Store Sync discount port backed by an offer book. */
export class OfferDiscounts implements DiscountPort {
  private readonly book: OfferBook;
  private readonly now: () => Date;

  constructor(book: OfferBook, now: () => Date = () => new Date()) {
    this.book = book;
    this.now = now;
  }

  async forCart(
    shopId: string,
    q: { cartId: string | undefined; cart: PayPalCart; agentClient: string | undefined },
  ): Promise<AppliedDiscountIn[]> {
    if (!q.agentClient) return [];
    const lines = (q.cart.items ?? [])
      .filter((it) => it.variant_id && it.quantity > 0)
      .map((it) => ({ variantId: it.variant_id!, quantity: it.quantity }));
    return this.book.discountsFor(shopId, q.agentClient, lines, this.now());
  }
}
