import { z } from "zod";
import { requireShop } from "@/lib/console/server/data";
import { closeSession, openSession, sessionKey } from "@/lib/console/server/session";
import { allow, clientIp, json, sameOrigin } from "../_lib/http";

const Body = z.object({ shop: z.string().trim().min(1).max(80) });

/**
 * Opens a merchant session for a shop: an httpOnly cookie, valid 12 hours,
 * that lets this browser read the shop's floors, costs, orders and
 * negotiations in the Console and act on them. While shops have no accounts
 * of their own, this is the demo merchant sign-in.
 */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { ok: false, message: "Sign in from the Console" });
  if (!allow(`session:${clientIp(req)}`, 10, 60_000)) {
    return json(429, { ok: false, message: "Too many sign-ins in a minute; wait a moment and try again" }, { "retry-after": "30" });
  }
  const key = sessionKey();
  if (!key) return json(503, { ok: false, message: "Merchant sign-in isn't configured on this deployment" });
  let shopSlug: string;
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json(400, { ok: false, message: "Send the shop to sign in to, as { shop }" });
    shopSlug = parsed.data.shop;
  } catch {
    return json(400, { ok: false, message: "Send the shop to sign in to, as { shop }" });
  }
  try {
    const shop = await requireShop(shopSlug);
    if (!shop) return json(404, { ok: false, message: `No shop called ${shopSlug}` });
    const { cookie, expiresAt } = openSession(shop.slug, key);
    return json(200, { ok: true, shop: shop.slug, expiresAt }, { "set-cookie": cookie });
  } catch (err) {
    console.error("console.session", err);
    return json(500, { ok: false, message: "Something went wrong on our side; try again" });
  }
}

/** Ends the merchant session on this browser. */
export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { ok: false, message: "Sign out from the Console" });
  return json(200, { ok: true }, { "set-cookie": closeSession() });
}
