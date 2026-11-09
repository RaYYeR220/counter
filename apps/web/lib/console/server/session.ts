import "server-only";
import { readCookie, SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySession } from "../session-token";

/** Path the session cookie is sent on: only the Console's own API needs it. */
const COOKIE_PATH = "/api/console";

/**
 * The key merchant sessions are signed with. Until shops have real accounts
 * this is the same `MERCHANT_DEMO_KEY` that guards the merchant API; without
 * it no session can be issued and every merchant view stays closed.
 */
export function sessionKey(): string | undefined {
  return process.env.MERCHANT_DEMO_KEY || undefined;
}

/** True when the request carries a valid merchant session for `shop`. */
export function merchantView(req: Request, shop: string): boolean {
  const key = sessionKey();
  if (!key) return false;
  return verifySession(readCookie(req.headers.get("cookie"), SESSION_COOKIE), shop, key);
}

/** A `Set-Cookie` value opening a session for `shop`, and when it ends. */
export function openSession(shop: string, key: string, now: number = Date.now()): { cookie: string; expiresAt: string } {
  const value = signSession(shop, key, now);
  return {
    cookie: `${SESSION_COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Strict`,
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
}

/** A `Set-Cookie` value that ends the session. */
export function closeSession(): string {
  return `${SESSION_COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
