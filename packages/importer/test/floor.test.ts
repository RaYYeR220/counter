import { describe, expect, it } from "vitest";
import { suggestFloor } from "../src/floor";
import type { MarketCheck } from "../src/types";

const market = (lowCents: number): MarketCheck => ({
  comparable: [],
  lowCents,
  medianCents: lowCents,
  highCents: lowCents,
  position: "within",
  checkedAt: "2026-11-09T00:00:00.000Z",
});

describe("suggestFloor", () => {
  it("rounds the policy discount down to the nearest 50 cents", () => {
    // 3400 × 0.85 = 2890 → 2850
    expect(suggestFloor({ priceCents: 3400 }, undefined, { maxDiscountPct: 15 })).toBe(2850);
  });

  it("never goes below cost plus 25%", () => {
    // policy: 3000 × 0.5 = 1500; cost: 2000 × 1.25 = 2500
    expect(suggestFloor({ priceCents: 3000, costCents: 2000 }, undefined, { maxDiscountPct: 50 })).toBe(2500);
  });

  it("rounds the cost bound up to a whole cent", () => {
    // 1150 × 1.25 = 1437.5 → 1438
    expect(suggestFloor({ priceCents: 1600, costCents: 1150 }, undefined, { maxDiscountPct: 50 })).toBe(1438);
  });

  it("never goes below 90% of the market low", () => {
    // policy: 3400 × 0.85 → 2850; market: 3300 × 0.9 = 2970
    expect(suggestFloor({ priceCents: 3400 }, market(3300), { maxDiscountPct: 15 })).toBe(2970);
  });

  it("ignores a market low that is under the policy floor", () => {
    expect(suggestFloor({ priceCents: 3400 }, market(699), { maxDiscountPct: 15 })).toBe(2850);
  });

  it("is capped at the list price", () => {
    expect(suggestFloor({ priceCents: 3000, costCents: 2800 }, market(5000), { maxDiscountPct: 15 })).toBe(3000);
  });

  it("is the list price when the policy allows no discount", () => {
    expect(suggestFloor({ priceCents: 3450 }, undefined, { maxDiscountPct: 0 })).toBe(3450);
  });

  it("treats a cost of 0 as unknown", () => {
    expect(suggestFloor({ priceCents: 1000, costCents: 0 }, undefined, { maxDiscountPct: 20 })).toBe(800);
  });

  it("is 0 for an unpriced variant", () => {
    expect(suggestFloor({ priceCents: 0 }, market(2000), { maxDiscountPct: 15 })).toBe(0);
  });
});
