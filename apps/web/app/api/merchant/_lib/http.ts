import "server-only";
import { timingSafeEqual } from "node:crypto";
import { PayPalApiError } from "@counter/paypal";
import { PlatformError } from "@counter/platform";
import type { z } from "zod";

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Configuration errors thrown by the server singletons, answered as 503 instead of a crash. */
const NOT_CONFIGURED: Array<{ match: RegExp; error: string }> = [
  { match: /PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set/, error: "paypal_not_configured" },
  { match: /DATABASE_URL is not set/, error: "database_not_configured" },
  { match: /needs env\.partnerMerchantId/, error: "paypal_partner_not_configured" },
];

/** Maps any failure to a JSON answer: business refusals, PayPal errors, missing configuration, then 500. */
export function errorResponse(err: unknown, where: string): Response {
  if (err instanceof PlatformError) return json(err.httpStatus, { error: err.code, message: err.message });
  if (err instanceof PayPalApiError) {
    // PayPal refusing the request itself (expired authorization, already refunded...) vs. PayPal or our credentials failing.
    const refused = err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403;
    return json(refused ? 422 : 502, {
      error: refused ? "paypal_refused" : "paypal_unavailable",
      message: err.message,
      paypal_status: err.status,
      issue: err.issue ?? null,
      debug_id: err.debugId ?? null,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  for (const c of NOT_CONFIGURED) if (c.match.test(message)) return json(503, { error: c.error, message });
  console.error(where, err);
  return json(500, { error: "internal_error", message: "Something went wrong on our side; try again" });
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Stand-in for merchant sign-in until shops have real accounts: the
 * `x-merchant-key` header must equal the `MERCHANT_DEMO_KEY` environment
 * variable. Browser links (onboarding) may pass it as `?key=` instead.
 * Without `MERCHANT_DEMO_KEY` every merchant call is refused.
 * Returns a response to send back, or null when the caller may proceed.
 */
export function requireMerchant(req: Request, opts: { allowQueryKey?: boolean } = {}): Response | null {
  const expected = process.env.MERCHANT_DEMO_KEY;
  if (!expected) {
    return json(503, { error: "merchant_auth_not_configured", message: "Set MERCHANT_DEMO_KEY to enable the merchant API" });
  }
  const given = req.headers.get("x-merchant-key") ?? (opts.allowQueryKey ? new URL(req.url).searchParams.get("key") : null);
  if (!given || !sameSecret(given, expected)) {
    return json(401, { error: "unauthorized", message: "Send the merchant key in the x-merchant-key header" });
  }
  return null;
}

/** Parses a JSON body (an empty body reads as `{}`) against `schema`; a 400 response when it does not fit. */
export async function readBody<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, response: json(400, { error: "invalid_request", message: "Body must be JSON" }) };
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: json(400, {
        error: "invalid_request",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}
