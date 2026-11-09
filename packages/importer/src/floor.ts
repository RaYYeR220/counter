import type { FloorPolicy, MarketCheck, VariantDraft } from "./types";

/**
 * The suggested negotiation floor for a variant: the lowest unit price the
 * seller agent may agree to. The rule is deterministic so a merchant can
 * check it by hand:
 *
 *     floor = max(
 *       cost × 1.25                         (when the cost is known; rounded up to a cent),
 *       price × (1 − maxDiscountPct / 100)  (rounded down to 50 cents),
 *       market.low × 0.9                    (when there is a market check; rounded up to a cent),
 *     )
 *
 * and never above the list price. A cost of 0 counts as unknown.
 */
export function suggestFloor(
  variant: Pick<VariantDraft, "priceCents" | "costCents">,
  market: Pick<MarketCheck, "lowCents"> | undefined,
  policy: FloorPolicy,
): number {
  const price = variant.priceCents;
  if (!(price > 0)) return 0;
  const discount = Math.min(Math.max(policy.maxDiscountPct, 0), 100);
  const policyFloor = Math.floor((price * (1 - discount / 100)) / 50) * 50;
  const costFloor = variant.costCents ? Math.ceil(variant.costCents * 1.25) : 0;
  const marketFloor = market && market.lowCents > 0 ? Math.ceil(market.lowCents * 0.9) : 0;
  return Math.min(price, Math.max(policyFloor, costFloor, marketFloor));
}
