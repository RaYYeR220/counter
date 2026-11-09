import { describe, expect, it } from "vitest";
import {
  bestDeal,
  evaluate,
  floorGuard,
  SMALL_CART_MAX_PCT,
  type Evaluation,
  type LineEconomics,
  type Proposal,
  type ShopPolicy,
} from "../src/engine";

// Juniper Clay economics from the demo catalog.
const SAGE12 = { variantId: "JC-MUG-SPECKLE-SAGE-12", listCents: 3400, floorCents: 2900, stock: 6 };
const INK8 = { variantId: "JC-MUG-SPECKLE-INK-8", listCents: 3000, floorCents: 2550, stock: 7 };
const BOWL6 = { variantId: "JC-BOWL-EVERYDAY-SAGE-6", listCents: 2800, floorCents: 2400, stock: 10 };
const SOLD_OUT = { variantId: "JC-MUG-SPECKLE-RUST-8", listCents: 3000, floorCents: 2550, stock: 0 };

const JUNIPER: ShopPolicy = { enabled: true, maxDiscountPct: 15, bundleMinItems: 3 };

function line(v: Omit<LineEconomics, "quantity">, quantity: number): LineEconomics {
  return { ...v, quantity };
}

const units = (e: Evaluation) => e.lines.map((l) => l.unitCents);

describe("evaluate: accepting and clamping", () => {
  it("accepts a compliant per-line proposal unchanged", () => {
    const e = evaluate([line(SAGE12, 3)], JUNIPER, { lines: [{ variantId: SAGE12.variantId, unitCents: 3000 }] });
    expect(e.verdict).toBe("accept");
    expect(e.lines).toEqual([{ variantId: SAGE12.variantId, quantity: 3, unitCents: 3000, listCents: 3400 }]);
    expect(e.discountCents).toBe(1200);
    expect(e.reasons).toEqual([]);
  });

  it("answers a unit price below the floor with a counter above it, so the floor stays private", () => {
    const e = evaluate([line(SAGE12, 3)], JUNIPER, { lines: [{ variantId: SAGE12.variantId, unitCents: 500 }] });
    expect(e.verdict).toBe("clamped");
    // floor $29.00 + 40% of the $5.00 gap to list, rounded up to 50 cents
    expect(units(e)).toEqual([3100]);
    expect(floorGuard(SAGE12)).toBe(3100);
    expect(e.discountCents).toBe(900);
    expect(e.reasons).toContain(`floor:${SAGE12.variantId}`);
  });

  it("never raises a price above list", () => {
    const e = evaluate([line(SAGE12, 3)], JUNIPER, { lines: [{ variantId: SAGE12.variantId, unitCents: 4000 }] });
    expect(e.verdict).toBe("clamped");
    expect(units(e)).toEqual([3400]);
    expect(e.discountCents).toBe(0);
    expect(e.reasons).toContain(`above_list:${SAGE12.variantId}`);
  });

  it("keeps lines the proposal does not mention at list", () => {
    const e = evaluate([line(SAGE12, 2), line(INK8, 1)], JUNIPER, {
      lines: [{ variantId: INK8.variantId, unitCents: 2700 }],
    });
    expect(e.verdict).toBe("accept");
    expect(units(e)).toEqual([3400, 2700]);
    expect(e.discountCents).toBe(300);
  });

  it("ignores proposal lines that are not in the cart", () => {
    const e = evaluate([line(SAGE12, 3)], JUNIPER, {
      lines: [
        { variantId: SAGE12.variantId, unitCents: 3100 },
        { variantId: "NOT-IN-CART", unitCents: 1 },
      ],
    });
    expect(e.verdict).toBe("clamped");
    expect(units(e)).toEqual([3100]);
    expect(e.reasons).toContain("not_in_cart:NOT-IN-CART");
  });
});

describe("evaluate: maximum discount", () => {
  it("caps the total discount at maxDiscountPct of the list subtotal", () => {
    const policy = { ...JUNIPER, maxDiscountPct: 10 };
    const e = evaluate([line(SAGE12, 3)], policy, { lines: [{ variantId: SAGE12.variantId, unitCents: 2900 }] });
    // 10% of $102.00 is $10.20, i.e. $3.40 off each mug.
    expect(e.verdict).toBe("clamped");
    expect(units(e)).toEqual([3060]);
    expect(e.discountCents).toBe(1020);
    expect(e.reasons).toContain("max_discount");
  });

  it("spreads a capped discount across lines in proportion to what was asked", () => {
    const policy = { ...JUNIPER, maxDiscountPct: 10 };
    // Asks $5.00 off the mug and $4.00 off each bowl ($13.00); the cap is 10% of $90.00 = $9.00.
    const e = evaluate([line(SAGE12, 1), line(BOWL6, 2)], policy, {
      lines: [
        { variantId: SAGE12.variantId, unitCents: 2900 },
        { variantId: BOWL6.variantId, unitCents: 2400 },
      ],
    });
    expect(e.verdict).toBe("clamped");
    expect(e.discountCents).toBe(900);
    const [mugOff, bowlOff] = e.lines.map((l) => l.listCents - l.unitCents);
    // 500:400 per unit asked; the cap keeps roughly that ratio.
    expect(Math.abs(mugOff! / bowlOff! - 500 / 400)).toBeLessThan(0.05);
  });

  it("treats a 100% lowball as a request for the deepest deal the rules allow", () => {
    const e = evaluate([line(SAGE12, 3)], JUNIPER, { percentOff: 100 });
    expect(e.verdict).toBe("clamped");
    expect(e.lines).toEqual(bestDeal([line(SAGE12, 3)], JUNIPER).lines);
    expect(units(e)).toEqual([3100]);
  });

  it("still takes an ask at or just above the floor as it is", () => {
    const e = evaluate([line(SAGE12, 3)], JUNIPER, { lines: [{ variantId: SAGE12.variantId, unitCents: 2900 }] });
    expect(e.verdict).toBe("accept");
    expect(units(e)).toEqual([2900]);
  });
});

describe("evaluate: small carts and bundles", () => {
  it(`allows up to ${SMALL_CART_MAX_PCT}% off a single item`, () => {
    const ok = evaluate([line(SAGE12, 1)], JUNIPER, { lines: [{ variantId: SAGE12.variantId, unitCents: 3230 }] });
    expect(ok.verdict).toBe("accept");
    expect(ok.discountCents).toBe(170);

    const deeper = evaluate([line(SAGE12, 1)], JUNIPER, { lines: [{ variantId: SAGE12.variantId, unitCents: 3000 }] });
    expect(deeper.verdict).toBe("clamped");
    expect(units(deeper)).toEqual([3230]);
    expect(deeper.reasons).toContain(`small_cart_limit:${SAGE12.variantId}`);
  });

  it("treats several units of one item below bundleMinItems as a small cart", () => {
    const e = evaluate([line(SAGE12, 2)], JUNIPER, { lines: [{ variantId: SAGE12.variantId, unitCents: 2900 }] });
    expect(units(e)).toEqual([3230]);
  });

  it("allows deeper discounts once total units reach bundleMinItems", () => {
    const e = evaluate([line(SAGE12, 3)], JUNIPER, { lines: [{ variantId: SAGE12.variantId, unitCents: 2900 }] });
    expect(e.verdict).toBe("accept");
    expect(units(e)).toEqual([2900]);
  });

  it("allows deeper discounts for two distinct items", () => {
    const e = evaluate([line(SAGE12, 1), line(INK8, 1)], JUNIPER, {
      lines: [
        { variantId: SAGE12.variantId, unitCents: 2900 },
        { variantId: INK8.variantId, unitCents: 2550 },
      ],
    });
    // Floors give $9.50 off $64.00 (14.8%), inside the 15% cap.
    expect(e.verdict).toBe("accept");
    expect(e.discountCents).toBe(950);
  });
});

describe("evaluate: policy and stock", () => {
  const OFF: ShopPolicy = { ...JUNIPER, enabled: false };

  it("refuses any discount when negotiation is disabled", () => {
    const e = evaluate([line(SAGE12, 3)], OFF, { percentOff: 5 });
    expect(e.verdict).toBe("refuse");
    expect(units(e)).toEqual([3400]);
    expect(e.discountCents).toBe(0);
    expect(e.reasons).toContain("negotiation_disabled");
  });

  it("accepts list price when negotiation is disabled", () => {
    const e = evaluate([line(SAGE12, 3)], OFF, { percentOff: 0 });
    expect(e.verdict).toBe("accept");
    expect(e.discountCents).toBe(0);
  });

  it("refuses a cart with an out-of-stock line", () => {
    const e = evaluate([line(SAGE12, 3), line(SOLD_OUT, 1)], JUNIPER, { percentOff: 5 });
    expect(e.verdict).toBe("refuse");
    expect(e.discountCents).toBe(0);
    expect(units(e)).toEqual([3400, 3000]);
    expect(e.reasons).toContain(`out_of_stock:${SOLD_OUT.variantId}`);
  });

  it("refuses a cart asking for more units than are in stock", () => {
    const e = evaluate([line(SAGE12, 7)], JUNIPER, { percentOff: 5 });
    expect(e.verdict).toBe("refuse");
    expect(e.reasons).toContain(`insufficient_stock:${SAGE12.variantId}`);
  });

  it("refuses when no discount is possible for the cart", () => {
    const atFloor = { variantId: "AT-FLOOR", listCents: 2000, floorCents: 2000, stock: 9 };
    const e = evaluate([line(atFloor, 3)], JUNIPER, { percentOff: 10 });
    expect(e.verdict).toBe("refuse");
    expect(e.discountCents).toBe(0);
    expect(e.reasons).toContain(`floor:${atFloor.variantId}`);
  });
});

describe("evaluate: proposal forms and rounding", () => {
  it("turns percentOff into per-unit prices", () => {
    const e = evaluate([line(SAGE12, 3)], JUNIPER, { percentOff: 10 });
    expect(e.verdict).toBe("accept");
    expect(units(e)).toEqual([3060]);
  });

  it("rounds percentage discounts down to the cent", () => {
    const beans = { variantId: "NP-GUJI-LIGHT-WB-250", listCents: 1900, floorCents: 1500, stock: 18 };
    // 12.5% of $19.00 is $2.375; the unit price rounds up to $16.63.
    const e = evaluate([line(beans, 3)], JUNIPER, { percentOff: 12.5 });
    expect(units(e)).toEqual([1663]);
    expect(e.discountCents).toBe(3 * 237);
  });

  it("rounds fractional unit prices up to the cent", () => {
    const e = evaluate([line(SAGE12, 3)], JUNIPER, { lines: [{ variantId: SAGE12.variantId, unitCents: 2999.2 }] });
    expect(units(e)).toEqual([3000]);
    expect(e.verdict).toBe("accept");
  });

  it("spreads a total discount across units in whole cents", () => {
    const e = evaluate([line(SAGE12, 1), line(INK8, 2)], JUNIPER, { totalDiscountCents: 1000 });
    expect(e.verdict).toBe("accept");
    expect(e.discountCents).toBe(1000);
    for (const l of e.lines) expect(Number.isInteger(l.unitCents)).toBe(true);
  });

  it("never gives more than a total discount asks for", () => {
    // Three identical units cannot share $10.00 evenly; the deal is $9.99.
    const e = evaluate([line(SAGE12, 3)], JUNIPER, { totalDiscountCents: 1000 });
    expect(e.discountCents).toBe(999);
    expect(units(e)).toEqual([3067]);
  });

  it.each<[string, Proposal]>([
    ["NaN unit price", { lines: [{ variantId: SAGE12.variantId, unitCents: Number.NaN }] }],
    ["negative percent", { percentOff: -10 }],
    ["percent over 100", { percentOff: 150 }],
    ["infinite percent", { percentOff: Number.POSITIVE_INFINITY }],
    ["negative total discount", { totalDiscountCents: -500 }],
    ["empty object", {} as Proposal],
  ])("refuses an invalid proposal: %s", (_name, proposal) => {
    const e = evaluate([line(SAGE12, 3)], JUNIPER, proposal);
    expect(e.verdict).toBe("refuse");
    expect(e.reasons).toContain("invalid_proposal");
    expect(e.discountCents).toBe(0);
  });

  it("rejects malformed cart economics", () => {
    expect(() => evaluate([line(SAGE12, 0)], JUNIPER, { percentOff: 0 })).toThrow(RangeError);
    expect(() => evaluate([line({ ...SAGE12, listCents: 34.5 }, 1)], JUNIPER, { percentOff: 0 })).toThrow(RangeError);
    expect(() => evaluate([line(SAGE12, 1), line(SAGE12, 1)], JUNIPER, { percentOff: 0 })).toThrow(RangeError);
    expect(() => evaluate([], JUNIPER, { percentOff: 0 })).toThrow(RangeError);
  });
});

describe("bestDeal", () => {
  it("is the lowest total the rules allow for the cart", () => {
    // A request for the deepest deal is a lowball: it is answered at the floor guard, not the floor.
    expect(bestDeal([line(SAGE12, 3)], JUNIPER).discountCents).toBe(900);
    expect(bestDeal([line(SAGE12, 1)], JUNIPER).discountCents).toBe(170);
    expect(bestDeal([line(SAGE12, 1), line(INK8, 1)], { ...JUNIPER, maxDiscountPct: 10 }).discountCents).toBe(550);
    expect(bestDeal([line(SAGE12, 3)], { ...JUNIPER, enabled: false }).discountCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Property checks with a seeded generator, so failures reproduce.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = ReturnType<typeof mulberry32>;
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rand, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

function randomCart(r: Rand, maxList: number, maxQty: number): LineEconomics[] {
  const n = int(r, 1, 4);
  return Array.from({ length: n }, (_, i) => {
    const listCents = int(r, 50, maxList);
    const floorCents = int(r, Math.floor(listCents * 0.4), listCents);
    const quantity = int(r, 1, maxQty);
    const stock = r() < 0.05 ? int(r, 0, quantity) : int(r, quantity, quantity + 10);
    return { variantId: `V${i}`, quantity, listCents, floorCents, stock };
  });
}

function randomPolicy(r: Rand): ShopPolicy {
  return { enabled: r() > 0.1, maxDiscountPct: pick(r, [0, 5, 10, 12, 15, 30, 100]), bundleMinItems: int(r, 1, 6) };
}

function randomProposal(r: Rand, lines: LineEconomics[]): Proposal {
  const kind = r();
  if (kind < 0.5) {
    return {
      lines: lines
        .filter(() => r() < 0.9)
        .map((l) => ({
          variantId: l.variantId,
          unitCents: pick(r, [0, -100, l.floorCents - 1, l.floorCents, l.listCents, l.listCents + 1, int(r, 0, l.listCents * 2), r() * l.listCents]),
        })),
    };
  }
  if (kind < 0.8) return { percentOff: pick(r, [0, 1, 4.99, 5, 10, 12.5, 15, 33.3, 50, 99.9, 100]) };
  return { totalDiscountCents: int(r, 0, lines.reduce((s, l) => s + l.listCents * l.quantity, 0)) };
}

const isBundle = (lines: LineEconomics[], p: ShopPolicy) =>
  lines.reduce((s, l) => s + l.quantity, 0) >= p.bundleMinItems || lines.length >= 2;

/** Every rule the engine promises, written out independently of the engine. */
function compliant(lines: LineEconomics[], policy: ShopPolicy, unitCents: number[]): boolean {
  const subtotal = lines.reduce((s, l) => s + l.listCents * l.quantity, 0);
  let discount = 0;
  for (const [i, l] of lines.entries()) {
    const u = unitCents[i]!;
    if (!Number.isInteger(u) || u < l.floorCents || u > l.listCents) return false;
    const off = l.listCents - u;
    if (off > 0 && !policy.enabled) return false;
    if (!isBundle(lines, policy) && off * 100 > l.listCents * SMALL_CART_MAX_PCT) return false;
    discount += off * l.quantity;
  }
  return discount * 100 <= subtotal * policy.maxDiscountPct;
}

describe("evaluate: properties", () => {
  it("never crosses a floor, the cap, the small-cart limit or list price (5000 seeded cases)", () => {
    const r = mulberry32(20261109);
    let deals = 0;
    for (let k = 0; k < 5000; k++) {
      const lines = randomCart(r, 20000, 6);
      const policy = randomPolicy(r);
      const proposal = randomProposal(r, lines);
      const e = evaluate(lines, policy, proposal);
      const ctx = JSON.stringify({ k, lines, policy, proposal, e });

      expect(e.lines.map((l) => l.variantId), ctx).toEqual(lines.map((l) => l.variantId));
      expect(e.lines.map((l) => l.quantity), ctx).toEqual(lines.map((l) => l.quantity));
      expect(e.discountCents, ctx).toBe(e.lines.reduce((s, l) => s + (l.listCents - l.unitCents) * l.quantity, 0));
      if (e.verdict === "refuse") {
        expect(e.discountCents, ctx).toBe(0);
        expect(units(e), ctx).toEqual(lines.map((l) => l.listCents));
        continue;
      }
      expect(compliant(lines, policy, units(e)), ctx).toBe(true);
      expect(lines.every((l) => l.stock >= l.quantity), ctx).toBe(true);
      if (e.discountCents > 0) deals++;
    }
    expect(deals).toBeGreaterThan(1000);
  });

  it("returns the closest compliant deal: the largest discount allowed without pricing any line below the ask", () => {
    const r = mulberry32(7);
    for (let k = 0; k < 300; k++) {
      const lines = randomCart(r, 60, 3).slice(0, 3);
      const policy = { ...randomPolicy(r), enabled: true };
      const asked = lines.map((l) => int(r, 0, l.listCents));
      const e = evaluate(lines, policy, { lines: lines.map((l, i) => ({ variantId: l.variantId, unitCents: asked[i]! })) });
      const ctx = JSON.stringify({ k, lines, policy, asked, e });
      if (lines.some((l) => l.stock < l.quantity)) continue;

      // Brute force every compliant price vector that keeps each line at or above its ask.
      let best = 0;
      const ranges = lines.map((l, i) => [asked[i]! < l.floorCents ? floorGuard(l) : asked[i]!, l.listCents] as const);
      const walk = (i: number, acc: number[]) => {
        if (i === lines.length) {
          if (compliant(lines, policy, acc)) {
            const off = lines.reduce((s, l, j) => s + (l.listCents - acc[j]!) * l.quantity, 0);
            best = Math.max(best, off);
          }
          return;
        }
        const [lo, hi] = ranges[i]!;
        for (let u = lo; u <= hi; u++) walk(i + 1, [...acc, u]);
      };
      walk(0, []);

      expect(e.discountCents, ctx).toBe(best);
      if (e.verdict !== "refuse") {
        e.lines.forEach((l, i) => expect(l.unitCents, ctx).toBeGreaterThanOrEqual(Math.min(l.listCents, asked[i]!)));
      }
    }
  });
});
