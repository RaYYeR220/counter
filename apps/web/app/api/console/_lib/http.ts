import "server-only";
import type { Shop } from "@counter/db";
import { requireShop } from "@/lib/console/server/data";

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export type ShopCtx = { params: Promise<{ shop: string }> };

/** Resolves the shop in the path, or answers 404. */
export async function shopFrom(ctx: ShopCtx): Promise<{ shop: Shop } | { response: Response }> {
  const { shop: slug } = await ctx.params;
  const shop = await requireShop(slug).catch((err: unknown) => {
    if (err instanceof Error && /DATABASE_URL is not set/.test(err.message)) return undefined;
    throw err;
  });
  if (shop === undefined) return { response: json(503, { error: "database_not_configured", message: "The shop's database isn't configured" }) };
  if (!shop) return { response: json(404, { error: "not_found", message: `No shop called ${slug}` }) };
  return { shop };
}

export function failure(err: unknown, where: string): Response {
  console.error(where, err);
  return json(500, { error: "internal_error", message: "Something went wrong on our side; try again" });
}

// ---------------------------------------------------------------------------
// Per-IP fixed-window rate limits. In memory, so per server instance: enough to
// stop one visitor from running up model or PayPal calls on a public demo.

const windows = new Map<string, { start: number; count: number }>();

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

/** True while `key` has made fewer than `max` calls in the current window. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 5000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return true;
  }
  w.count += 1;
  return w.count <= max;
}

/** Mutations must come from this site's own pages. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}
