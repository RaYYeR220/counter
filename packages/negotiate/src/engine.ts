/**
 * The pricing engine has the final word on every negotiated deal. A seller
 * agent can propose anything; `evaluate` turns the proposal into the closest
 * deal the shop's rules allow, or refuses it. It is pure: no clock, no I/O.
 *
 * Rules, in the order they are applied:
 *
 * 1. Stock. Every line must be in stock for its full quantity, otherwise the
 *    proposal is refused.
 * 2. Policy. Any discount at all requires `policy.enabled`.
 * 3. List price is a ceiling. A unit price is never raised above list.
 * 4. Floor. A unit price never goes below the merchant's floor.
 * 5. Small carts. A cart that is not a bundle may take at most
 *    SMALL_CART_MAX_PCT off each unit's list price. A cart is a bundle when
 *    it holds at least `policy.bundleMinItems` units in total, or at least two
 *    distinct items.
 * 6. Cap. The total discount is at most `policy.maxDiscountPct` of the list
 *    subtotal, rounded down to the cent.
 *
 * All amounts are integer cents. Rounding never favors the buyer: fractional
 * unit prices round up, percentage discounts round down.
 *
 * Verdicts:
 * - `accept`: the proposal already follows every rule and is the deal as asked.
 * - `clamped`: the deal is the closest compliant one, meaning the largest
 *   discount the rules allow without pricing any line below what the proposal
 *   asked for it. When the cap forces a cut, the cut keeps each line's share of
 *   the requested discount as close as whole cents allow.
 * - `refuse`: no deal. Lines come back at list with no discount. This happens
 *   for stock problems, invalid proposals, and proposals that asked for a
 *   discount when the rules allow none for this cart.
 */

/** What the engine knows about one cart line. `floorCents` never leaves the server. */
export interface LineEconomics {
  variantId: string;
  quantity: number;
  listCents: number;
  floorCents: number;
  stock: number;
}

export interface ShopPolicy {
  enabled: boolean;
  /** Largest total discount, as a percentage of the list subtotal. */
  maxDiscountPct: number;
  /** Units needed for a single-item cart to count as a bundle. */
  bundleMinItems: number;
}

/** A seller's proposal, in one of three shapes. Amounts are cents; `percentOff` is 0–100. */
export type Proposal =
  | { lines: { variantId: string; unitCents: number }[] }
  | { totalDiscountCents: number }
  | { percentOff: number };

export type Verdict = "accept" | "clamped" | "refuse";

export interface DealLine {
  variantId: string;
  quantity: number;
  unitCents: number;
  listCents: number;
}

export interface Evaluation {
  verdict: Verdict;
  lines: DealLine[];
  discountCents: number;
  /** Machine-readable codes such as `floor:<variantId>` or `max_discount`. */
  reasons: string[];
}

/** Largest per-unit discount, in percent of list, for a cart that is not a bundle. */
export const SMALL_CART_MAX_PCT = 5;

export function listSubtotal(lines: readonly LineEconomics[]): number {
  return lines.reduce((s, l) => s + l.listCents * l.quantity, 0);
}

export function isBundle(lines: readonly LineEconomics[], policy: ShopPolicy): boolean {
  const units = lines.reduce((s, l) => s + l.quantity, 0);
  return units >= policy.bundleMinItems || lines.length >= 2;
}

function checkLines(lines: readonly LineEconomics[]): void {
  if (lines.length === 0) throw new RangeError("A cart needs at least one line");
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.variantId)) throw new RangeError(`Variant ${l.variantId} appears on more than one line`);
    seen.add(l.variantId);
    if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0) {
      throw new RangeError(`Quantity for ${l.variantId} must be a positive integer`);
    }
    if (!Number.isSafeInteger(l.listCents) || !Number.isSafeInteger(l.floorCents) || l.floorCents < 0) {
      throw new RangeError(`Prices for ${l.variantId} must be whole cents`);
    }
    if (l.floorCents > l.listCents) throw new RangeError(`Floor for ${l.variantId} is above its list price`);
    if (!Number.isSafeInteger(l.stock)) throw new RangeError(`Stock for ${l.variantId} must be an integer`);
  }
}

function listDeal(lines: readonly LineEconomics[], verdict: Verdict, reasons: string[]): Evaluation {
  return {
    verdict,
    lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitCents: l.listCents, listCents: l.listCents })),
    discountCents: 0,
    reasons,
  };
}

/**
 * Per-unit discounts d[i] in [0, max[i]] whose total sum(qty[i] * d[i]) is the
 * largest value not above `target`. Among those, each line stays as close as
 * possible to its proportional share of the total.
 */
export function fitDiscount(qty: readonly number[], max: readonly number[], target: number): number[] {
  const n = qty.length;
  const full = qty.reduce((s, q, i) => s + q * max[i]!, 0);
  if (full <= target) return [...max];
  if (target <= 0) return max.map(() => 0);

  // reach[i][s] = 1 when some choice for lines i..n-1 sums to exactly s.
  const reach: Uint8Array[] = Array.from({ length: n + 1 }, () => new Uint8Array(target + 1));
  reach[n]![0] = 1;
  for (let i = n - 1; i >= 0; i--) {
    const next = reach[i + 1]!;
    const cur = reach[i]!;
    const q = qty[i]!;
    const window = max[i]! + 1;
    // Sliding window along each residue class mod q: s is reachable when any
    // of s, s-q, ..., s-q*max is reachable by the remaining lines.
    for (let r = 0; r < q && r <= target; r++) {
      let count = 0;
      let k = 0;
      for (let s = r; s <= target; s += q, k++) {
        count += next[s]!;
        if (k >= window) count -= next[s - window * q]!;
        if (count > 0) cur[s] = 1;
      }
    }
  }

  let best = target;
  while (best > 0 && !reach[0]![best]) best--;

  const out: number[] = [];
  let remaining = best;
  for (let i = 0; i < n; i++) {
    const q = qty[i]!;
    const m = max[i]!;
    const start = Math.min(m, Math.max(0, Math.round((m * best) / full)));
    let chosen = -1;
    for (let step = 0; chosen < 0 && step <= m; step++) {
      for (const d of step === 0 ? [start] : [start - step, start + step]) {
        if (d < 0 || d > m) continue;
        const rest = remaining - q * d;
        if (rest >= 0 && reach[i + 1]![rest]) {
          chosen = d;
          break;
        }
      }
    }
    // `best` is reachable from line 0, so a choice always exists here.
    out.push(chosen);
    remaining -= q * chosen;
  }
  return out;
}

/** Proposed unit price for each cart line, or null when the proposal is not usable. */
function proposedUnits(lines: readonly LineEconomics[], proposal: Proposal, reasons: string[]): number[] | null {
  if ("lines" in proposal && Array.isArray(proposal.lines)) {
    const asked = new Map<string, number>();
    for (const p of proposal.lines) {
      if (typeof p?.variantId !== "string" || typeof p.unitCents !== "number" || !Number.isFinite(p.unitCents)) return null;
      if (!lines.some((l) => l.variantId === p.variantId)) {
        reasons.push(`not_in_cart:${p.variantId}`);
        continue;
      }
      if (!asked.has(p.variantId)) asked.set(p.variantId, Math.ceil(p.unitCents));
    }
    return lines.map((l) => asked.get(l.variantId) ?? l.listCents);
  }
  if ("percentOff" in proposal) {
    const pct = proposal.percentOff;
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
    // The epsilon keeps exact products such as 3400 * 15 / 100 from landing a hair under 510.
    return lines.map((l) => l.listCents - Math.floor((l.listCents * pct) / 100 + 1e-9));
  }
  if ("totalDiscountCents" in proposal) {
    const total = proposal.totalDiscountCents;
    if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return null;
    const off = fitDiscount(
      lines.map((l) => l.quantity),
      lines.map((l) => l.listCents),
      Math.min(Math.floor(total), listSubtotal(lines)),
    );
    return lines.map((l, i) => l.listCents - off[i]!);
  }
  return null;
}

/** Evaluates a seller's proposal against the shop's rules. See the module comment for the rules. */
/** Share of the floor-to-list gap kept back when answering an offer below the floor. */
export const FLOOR_GUARD_SHARE = 0.4;

/**
 * The lowest unit price offered back to a buyer whose ask fell below the floor:
 * the floor plus part of the gap to list, rounded up to the next 50 cents and
 * never above list. Asks at or above the floor are still taken as they are.
 */
export function floorGuard(l: Pick<LineEconomics, "listCents" | "floorCents">): number {
  const gap = l.listCents - l.floorCents;
  if (gap <= 0) return l.listCents;
  const raised = l.floorCents + Math.ceil(gap * FLOOR_GUARD_SHARE);
  return Math.min(l.listCents, Math.ceil(raised / 50) * 50);
}

export function evaluate(lines: readonly LineEconomics[], policy: ShopPolicy, proposal: Proposal): Evaluation {
  checkLines(lines);

  const stockReasons: string[] = [];
  for (const l of lines) {
    if (l.stock <= 0) stockReasons.push(`out_of_stock:${l.variantId}`);
    else if (l.quantity > l.stock) stockReasons.push(`insufficient_stock:${l.variantId}`);
  }
  if (stockReasons.length) return listDeal(lines, "refuse", stockReasons);

  const reasons: string[] = [];
  const asked = proposal && typeof proposal === "object" ? proposedUnits(lines, proposal, reasons) : null;
  if (!asked) return listDeal(lines, "refuse", ["invalid_proposal"]);

  const bundle = isBundle(lines, policy);
  const pctBps = Math.round(Math.min(100, Math.max(0, policy.maxDiscountPct)) * 100);
  const cap = policy.enabled ? Math.floor((listSubtotal(lines) * pctBps) / 10000) : 0;

  // Project each line into [lowest allowed unit price, list].
  const projected = lines.map((l, i) => {
    const want = asked[i]!;
    if (want > l.listCents) {
      reasons.push(`above_list:${l.variantId}`);
      return l.listCents;
    }
    if (want === l.listCents) return want;
    if (!policy.enabled) {
      if (!reasons.includes("negotiation_disabled")) reasons.push("negotiation_disabled");
      return l.listCents;
    }
    let lowest = l.floorCents;
    if (want < l.floorCents) {
      // A lowball is answered above the floor, so one probe never reveals it.
      reasons.push(`floor:${l.variantId}`);
      lowest = floorGuard(l);
    }
    if (!bundle) {
      const smallCartLowest = l.listCents - Math.floor((l.listCents * SMALL_CART_MAX_PCT) / 100);
      if (smallCartLowest > lowest) {
        if (want < smallCartLowest && want >= l.floorCents) reasons.push(`small_cart_limit:${l.variantId}`);
        lowest = smallCartLowest;
      }
    }
    return Math.max(want, lowest);
  });

  let off = lines.map((l, i) => l.listCents - projected[i]!);
  const projectedDiscount = off.reduce((s, d, i) => s + d * lines[i]!.quantity, 0);
  if (projectedDiscount > cap) {
    reasons.push("max_discount");
    off = fitDiscount(
      lines.map((l) => l.quantity),
      off,
      cap,
    );
  }

  const deal: DealLine[] = lines.map((l, i) => ({
    variantId: l.variantId,
    quantity: l.quantity,
    unitCents: l.listCents - off[i]!,
    listCents: l.listCents,
  }));
  const discountCents = deal.reduce((s, l) => s + (l.listCents - l.unitCents) * l.quantity, 0);
  const askedDiscount = lines.some((l, i) => asked[i]! < l.listCents);

  if (askedDiscount && discountCents === 0) return listDeal(lines, "refuse", reasons);
  const exact = reasons.length === 0 && deal.every((l, i) => l.unitCents === asked[i]);
  return { verdict: exact ? "accept" : "clamped", lines: deal, discountCents, reasons };
}

/** The deepest deal the rules allow for this cart: its lowest allowed total. */
export function bestDeal(lines: readonly LineEconomics[], policy: ShopPolicy): Evaluation {
  return evaluate(lines, policy, { percentOff: 100 });
}
