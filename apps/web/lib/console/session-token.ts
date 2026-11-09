import { createHmac, timingSafeEqual } from "node:crypto";

// The merchant session that unlocks a shop's Console data (floors, costs,
// orders, negotiation transcripts). The cookie value is
// `<shop>.<expiry ms>.<hex HMAC-SHA256 of "<shop>|<expiry ms>">`, keyed with
// the shop's merchant key, so it can't be forged, moved to another shop or
// kept past its expiry.

export const SESSION_COOKIE = "counter_merchant";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const SHOP = /^[a-z0-9][a-z0-9-]{0,79}$/;
const EXPIRY = /^\d{1,16}$/;
const MAC = /^[0-9a-f]{64}$/;

function mac(shop: string, expiry: string, key: string): string {
  return createHmac("sha256", key).update(`${shop}|${expiry}`).digest("hex");
}

/** A session token for `shop`, valid for `ttlMs` from `now`. */
export function signSession(shop: string, key: string, now: number = Date.now(), ttlMs: number = SESSION_TTL_MS): string {
  if (!SHOP.test(shop)) throw new RangeError(`Not a shop slug: ${JSON.stringify(shop)}`);
  if (!key) throw new Error("A merchant key is needed to sign a session");
  const expiry = String(Math.floor(now + ttlMs));
  return `${shop}.${expiry}.${mac(shop, expiry, key)}`;
}

/** True when `token` was signed with `key`, names `shop` and has not expired at `now`. */
export function verifySession(token: string | null | undefined, shop: string, key: string | null | undefined, now: number = Date.now()): boolean {
  if (!token || !key) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokenShop, expiry, given] = parts as [string, string, string];
  if (tokenShop !== shop || !SHOP.test(tokenShop)) return false;
  if (!EXPIRY.test(expiry) || !(Number(expiry) > now)) return false;
  if (!MAC.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(mac(tokenShop, expiry, key), "hex"));
}

/** The value of cookie `name` in a `Cookie` header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
