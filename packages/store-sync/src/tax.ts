import { applyBps, type Cents } from "./money";

/** States with no general sales tax on these goods. */
const ZERO_RATE_STATES = new Set(["OR", "MT", "NH", "DE"]);

/** Flat rate applied everywhere else, in basis points (7.25%). */
export const DEFAULT_TAX_BPS = 725;

export function taxRateBps(state: string | null | undefined): number {
  const st = state?.trim().toUpperCase();
  return st && ZERO_RATE_STATES.has(st) ? 0 : DEFAULT_TAX_BPS;
}

/**
 * Sales tax on a taxable base (subtotal - discount + shipping), rounded
 * half-up to the cent. A non-positive base is never taxed.
 */
export function taxCents(state: string | null | undefined, taxable: Cents): Cents {
  return applyBps(taxable, taxRateBps(state));
}
