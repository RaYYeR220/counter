import { z } from "zod";
import { actionError, runAction } from "@/lib/console/server/actions";
import type { ConsoleAction } from "@/lib/console/types";
import { allow, clientIp, json, requireMerchantView, sameOrigin, shopFrom, type ShopCtx } from "../../_lib/http";

// A market check runs one Channel3 search per product.
export const maxDuration = 60;

const Text = z.string().trim().min(1).max(100);

const Action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ship"), orderId: Text, carrier: Text, trackingNumber: Text }),
  z.object({ kind: z.literal("cancel"), orderId: Text, reason: z.string().trim().max(500).optional() }),
  z.object({ kind: z.literal("refund"), orderId: Text, amountCents: z.number().int().positive().optional() }),
  z.object({ kind: z.literal("set_floor"), variantId: Text, floorCents: z.number().int().positive().max(10_000_000) }),
  z.object({ kind: z.literal("market_check"), variantIds: z.array(Text).min(1).max(40) }),
]);

/**
 * Merchant actions from the Console: ship, cancel and refund orders, change a
 * floor, re-check market prices. Runs the platform's own fulfilment code on
 * the server, so no merchant credential ever reaches the browser. It needs a
 * merchant session, and only this site's pages may call it, a few times a
 * minute per visitor.
 */
export async function POST(req: Request, ctx: ShopCtx): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { ok: false, message: "Actions can only be sent from the Console" });
  if (!allow(`action:${clientIp(req)}`, 20, 60_000)) {
    return json(429, { ok: false, message: "Too many actions in a minute; wait a moment and try again" }, { "retry-after": "30" });
  }
  let action: ConsoleAction;
  try {
    const parsed = Action.safeParse(await req.json());
    if (!parsed.success) {
      return json(400, { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    }
    action = parsed.data;
  } catch {
    return json(400, { ok: false, message: "Send the action as JSON" });
  }
  try {
    const found = await shopFrom(ctx);
    if ("response" in found) return found.response;
    const denied = requireMerchantView(req, found.shop, "act on its orders and prices");
    if (denied) return denied;
    return json(200, await runAction(found.shop, action));
  } catch (err) {
    const { status, message } = actionError(err);
    return json(status, { ok: false, message });
  }
}
