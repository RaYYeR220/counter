import type { Money } from "./types";

/** Integer number of US cents. All cart arithmetic happens in this unit. */
export type Cents = number;

export const CURRENCY = "USD";

const DECIMAL = /^(-)?(\d*)(?:\.(\d*))?$/;

/**
 * Parses a decimal string ("25", "25.1", ".5") into integer cents.
 * Digits past the second decimal place are rounded half-up (away from zero).
 */
export function toCents(v: string): Cents {
  const m = DECIMAL.exec(v.trim());
  const whole = m?.[2] ?? "";
  const frac = m?.[3] ?? "";
  if (!m || (whole === "" && frac === "")) {
    throw new TypeError(`Not a decimal amount: ${JSON.stringify(v)}`);
  }
  const padded = (frac + "000").slice(0, 3);
  let cents = Number(whole || "0") * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1;
  return m[1] && cents !== 0 ? -cents : cents;
}

/** Formats integer cents as a two-decimal string, e.g. 2500 -> "25.00". */
export function fmt(c: Cents): string {
  if (!Number.isSafeInteger(c)) {
    throw new TypeError(`Cents must be a safe integer, got ${c}`);
  }
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${c < 0 ? "-" : ""}${whole}.${frac}`;
}

export function money(c: Cents): Money {
  return { currency_code: CURRENCY, value: fmt(c) };
}

/** Applies a rate in basis points to an amount, rounding half-up to the cent. */
export function applyBps(amount: Cents, bps: number): Cents {
  if (amount <= 0 || bps <= 0) return 0;
  return Math.floor((amount * bps + 5000) / 10000);
}
