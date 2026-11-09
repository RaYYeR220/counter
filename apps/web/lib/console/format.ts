const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** $34.00 from dollars; whole dollars drop the cents when `compact`. */
export function money(dollars: number | null | undefined, compact = false): string {
  if (dollars == null || !Number.isFinite(dollars)) return "–";
  return compact && Number.isInteger(dollars) ? usdWhole.format(dollars) : usd.format(dollars);
}

export function moneyCents(cents: number | null | undefined, compact = false): string {
  return cents == null ? "–" : money(cents / 100, compact);
}

/** "12 s", "4 min", "3 h", "2 d" since `iso`, measured against `now`. */
export function ago(iso: string | number | Date, now = Date.now()): string {
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export function pct(fraction: number | null | undefined, digits = 0): string {
  if (fraction == null || !Number.isFinite(fraction)) return "–";
  return `${(fraction * 100).toFixed(digits)}%`;
}
