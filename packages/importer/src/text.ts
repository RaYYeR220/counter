/** Uppercase, hyphenated, ASCII: "Café crème 12 oz" -> "CAFE-CREME-12-OZ". Cut at a word boundary when longer than `max`. */
export function slug(text: string, max = 40): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf("-");
  return (at > 0 ? cut.slice(0, at) : s.slice(0, max)).replace(/-+$/, "");
}

/** snake_case attribute key: "Dye lot" -> "dye_lot". */
export function attributeKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const TRACKING_PARAMS = new Set([
  "gclid", "gbraid", "wbraid", "dclid", "fbclid", "msclkid", "yclid", "igshid", "twclid", "ttclid", "li_fat_id",
  "mc_cid", "mc_eid", "srsltid", "_ga", "_gl", "_ke", "_kx", "ref", "ref_", "ref_src", "aid", "affiliate",
  "irclickid", "clickid", "cjevent", "sscid", "ranmid", "raneaid", "ransiteid", "spm", "scm",
  "_pos", "_sid", "_ss", "_psq", "_fid", "_bt", "trk", "tracking", "campaign",
]);
const TRACKING_PREFIXES = ["utm_", "pd_rd_", "pf_rd_", "hsa_", "oly_"];
/** Channel3 buy links carry the offer and click ids here. */
const CHANNEL3_PARAMS = new Set(["o", "aid", "uid"]);

/** Throws unless `raw` is an http(s) URL; returns it without tracking parameters or fragment. */
export function cleanUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new TypeError(`Not a URL: ${raw.slice(0, 200)}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new TypeError("Only http(s) product page URLs can be imported");
  const channel3 = url.hostname.endsWith("trychannel3.com");
  for (const key of [...url.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p)) || (channel3 && CHANNEL3_PARAMS.has(k))) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}

/** `example.com` for `https://www.example.com/x`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\d*\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** Every number written in `text`, as values: "1,250.00" and "1250" are both 1250. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER)) {
    let s = m[0];
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(/,/g, ".");
    // "1.2.3" is not one number; read its parts.
    const parts = (s.match(/\./g)?.length ?? 0) > 1 ? s.split(".") : [s];
    for (const p of parts) {
      const n = Number(p);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

/** Splits prose into sentences on ., ! or ? followed by whitespace (so "4.5" stays whole). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Drops every sentence that states a number the source does not contain, so
 * a written description cannot add a capacity, size or count that the
 * merchant's data never gave.
 */
export function keepSupportedSentences(text: string, source: string): { text: string; dropped: string[] } {
  const known = new Set(numbersIn(source));
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const s of sentences(text)) {
    if (numbersIn(s).every((n) => known.has(n))) kept.push(s);
    else dropped.push(s);
  }
  return { text: kept.join(" "), dropped };
}

/** "$1,234.50" -> 123450. Undefined for blanks, negatives and anything that is not a plain amount. */
export function parseMoneyCents(raw: string): number | undefined {
  let s = raw.trim().replace(/^(usd|us\$|\$)\s*/i, "").replace(/\s*(usd|\$)$/i, "").trim();
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** Rounds a decimal price in major units to cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}
