import { loadEvents } from "@/lib/console/server/data";
import { failure, json, requireMerchantView, shopFrom, type ShopCtx } from "../../_lib/http";

/**
 * The shop's activity, oldest first. `?since=<id>` returns only events after
 * that id, which is how the Console stays live; without it, the last 30 days.
 * Merchant session only.
 */
export async function GET(req: Request, ctx: ShopCtx): Promise<Response> {
  try {
    const found = await shopFrom(ctx);
    if ("response" in found) return found.response;
    const denied = requireMerchantView(req, found.shop);
    if (denied) return denied;
    const url = new URL(req.url);
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw != null && /^\d{1,15}$/.test(sinceRaw) ? Number(sinceRaw) : undefined;
    if (sinceRaw != null && since === undefined) return json(400, { error: "invalid_request", message: "since must be an event id" });
    const limitRaw = Number(url.searchParams.get("limit") ?? "");
    const events = await loadEvents(found.shop.slug, {
      ...(since !== undefined ? { since, limit: 500 } : {}),
      ...(Number.isFinite(limitRaw) && limitRaw > 0 ? { limit: limitRaw } : {}),
    });
    return json(200, { events, lastEventId: events.at(-1)?.id ?? since ?? 0 });
  } catch (err) {
    return failure(err, "console.events");
  }
}
