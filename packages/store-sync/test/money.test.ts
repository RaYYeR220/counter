import { describe, it, expect } from "vitest";
import { toCents, fmt, money, quoteShipping, taxCents, taxRateBps } from "../src/index";

describe("money", () => {
  it("round-trips decimal strings through integer cents", () => {
    expect(fmt(toCents("25.1"))).toBe("25.10");
    expect(toCents("25.00")).toBe(2500);
    expect(toCents("0.99")).toBe(99);
    expect(toCents("7")).toBe(700);
    expect(toCents(".5")).toBe(50);
  });

  it("rounds a third decimal half-up", () => {
    expect(toCents("1.005")).toBe(101);
    expect(toCents("1.004")).toBe(100);
    expect(toCents("-1.005")).toBe(-101);
  });

  it("rejects strings that are not decimals", () => {
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("")).toThrow();
    expect(() => toCents("1.2.3")).toThrow();
    expect(() => toCents("1e3")).toThrow();
  });

  it("formats cents with two decimals", () => {
    expect(fmt(0)).toBe("0.00");
    expect(fmt(5)).toBe("0.05");
    expect(fmt(1499)).toBe("14.99");
    expect(fmt(-150)).toBe("-1.50");
    expect(() => fmt(1.5)).toThrow();
  });

  it("builds USD Money objects", () => {
    expect(money(3280)).toEqual({ currency_code: "USD", value: "32.80" });
  });
});

describe("tax", () => {
  it("charges nothing in OR, MT, NH and DE", () => {
    for (const st of ["OR", "MT", "NH", "DE", "or"]) {
      expect(taxCents(st, 3099)).toBe(0);
    }
  });

  it("charges 7.25% elsewhere, rounded half-up to the cent", () => {
    // 30.99 * 0.0725 = 2.246775 -> 2.25
    expect(taxCents("CA", 2500 + 599)).toBe(225);
    // 20.00 * 0.0725 = 1.45 exactly
    expect(taxCents("NY", 2000)).toBe(145);
    // 0.20 * 0.0725 = 0.0145 -> 0.01
    expect(taxCents("TX", 20)).toBe(1);
    // 0.06 * 0.0725 = 0.00435 -> 0.00
    expect(taxCents("TX", 6)).toBe(0);
    // 2.00 * 0.0725 = 0.145 -> exact half cent rounds up to 0.15
    expect(taxCents("CA", 200)).toBe(15);
  });

  it("uses the default rate when the state is unknown", () => {
    expect(taxRateBps(undefined)).toBe(725);
    expect(taxCents(undefined, 10000)).toBe(725);
  });

  it("never taxes a non-positive base", () => {
    expect(taxCents("CA", 0)).toBe(0);
    expect(taxCents("CA", -500)).toBe(0);
  });
});

describe("shipping quotes", () => {
  // Monday 2026-11-09 12:00 UTC
  const monday = new Date("2026-11-09T12:00:00Z");
  const us = { country_code: "US", admin_area_1: "CA", postal_code: "90210" };

  it("offers STANDARD and EXPRESS for US addresses", () => {
    const quotes = quoteShipping(us, 2500, monday);
    expect(quotes.map((q) => q.id)).toEqual(["STANDARD", "EXPRESS"]);
    expect(quotes[0]!.priceCents).toBe(599);
    expect(quotes[1]!.priceCents).toBe(1499);
  });

  it("makes STANDARD free from $75 subtotal", () => {
    expect(quoteShipping(us, 7499, monday)[0]!.priceCents).toBe(599);
    expect(quoteShipping(us, 7500, monday)[0]!.priceCents).toBe(0);
    expect(quoteShipping(us, 7500, monday)[1]!.priceCents).toBe(1499);
  });

  it("estimates delivery in business days from now", () => {
    const [std, exp] = quoteShipping(us, 2500, monday);
    expect(std!.estimatedDelivery).toBe("2026-11-16"); // +5 business days
    expect(exp!.estimatedDelivery).toBe("2026-11-11"); // +2 business days
    // Friday -> skips the weekend
    const friday = new Date("2026-11-13T09:00:00Z");
    const [stdF, expF] = quoteShipping(us, 2500, friday);
    expect(expF!.estimatedDelivery).toBe("2026-11-17");
    expect(stdF!.estimatedDelivery).toBe("2026-11-20");
  });

  it("does not ship outside the US or without an address", () => {
    expect(quoteShipping({ country_code: "AU" }, 2500, monday)).toEqual([]);
    expect(quoteShipping(undefined, 2500, monday)).toEqual([]);
  });

  it("accepts a lowercase country code", () => {
    expect(quoteShipping({ country_code: "us" }, 2500, monday)).toHaveLength(2);
  });
});
