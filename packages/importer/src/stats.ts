import type { MarketCheck } from "./types";

/** Low (lower quartile), median and high (upper quartile); min and max under four prices. */
export function priceStats(prices: number[]): Pick<MarketCheck, "lowCents" | "medianCents" | "highCents"> {
  const s = [...prices].sort((a, b) => a - b);
  const n = s.length;
  const mid = (n - 1) / 2;
  const medianCents = Math.round((s[Math.floor(mid)]! + s[Math.ceil(mid)]!) / 2);
  if (n < 4) return { lowCents: s[0]!, medianCents, highCents: s[n - 1]! };
  return { lowCents: s[Math.floor((n - 1) * 0.25)]!, medianCents, highCents: s[Math.ceil((n - 1) * 0.75)]! };
}

export function positionOf(priceCents: number, range: Pick<MarketCheck, "lowCents" | "highCents">): MarketCheck["position"] {
  if (priceCents < range.lowCents) return "below";
  if (priceCents > range.highCents) return "above";
  return "within";
}
