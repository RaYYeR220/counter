// The parts of the suggested negotiation floor, so Studio can say why a floor
// is what it is. This is the rule `suggestFloor` in @counter/importer applies:
//
//   floor = min(price, max(price × (1 − max discount), cost × 1.25, market low × 0.9))
//
// The import action checks every floor it shows against `suggestFloor` itself
// and labels any it cannot explain as set by the import, so the two cannot
// drift apart unnoticed.

export type FloorSource = "policy" | "cost" | "market" | "price" | "given";

export interface FloorParts {
  /** price × (1 − max discount), rounded down to 50 cents. */
  policyCents: number;
  /** cost × 1.25, when the cost is known. */
  costCents: number;
  /** market low × 0.9, when there is a market check. */
  marketCents: number;
  floorCents: number;
  /** The part that set the floor. */
  source: Exclude<FloorSource, "given">;
}

export function floorParts(priceCents: number, costCents: number | undefined, marketLowCents: number | undefined, maxDiscountPct: number): FloorParts {
  if (!(priceCents > 0)) return { policyCents: 0, costCents: 0, marketCents: 0, floorCents: 0, source: "policy" };
  const discount = Math.min(Math.max(maxDiscountPct, 0), 100);
  const policy = Math.floor((priceCents * (1 - discount / 100)) / 50) * 50;
  const cost = costCents ? Math.ceil(costCents * 1.25) : 0;
  const market = marketLowCents && marketLowCents > 0 ? Math.ceil(marketLowCents * 0.9) : 0;
  const top = Math.max(policy, cost, market);
  const floor = Math.min(priceCents, top);
  const source: FloorParts["source"] = top > priceCents ? "price" : top === market && market > 0 ? "market" : top === cost && cost > 0 ? "cost" : "policy";
  return { policyCents: policy, costCents: cost, marketCents: market, floorCents: floor, source };
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** One sentence on why a floor is where it is. */
export function floorReason(parts: FloorParts, source: FloorSource, maxDiscountPct: number, origin: "csv" | "url" | "photo"): string {
  switch (source) {
    case "policy":
      return maxDiscountPct > 0
        ? `${maxDiscountPct}% under list, the shop's largest discount (rounded down to 50¢).`
        : "List price: this shop doesn't negotiate.";
    case "cost":
      return `Your cost × 1.25 (${money(parts.costCents)}), above the ${maxDiscountPct}% discount limit.`;
    case "market":
      return `The market's low end less 10% (${money(parts.marketCents)}): no deal undercuts other sellers by more.`;
    case "price":
      return parts.marketCents >= parts.costCents
        ? `Held at list price: it's already well under the market (the market rule alone would ask ${money(parts.marketCents)}).`
        : `Held at list price: your cost × 1.25 (${money(parts.costCents)}) leaves no room for a discount.`;
    case "given":
      return origin === "csv" ? "Taken from the floor column in your CSV." : "Set by the import.";
  }
}
