import { loadNegotiations } from "@/lib/console/server/data";
import { failure, json, shopFrom, type ShopCtx } from "../../_lib/http";

/**
 * Every price negotiation a buyer agent had with the shop's seller agent,
 * newest first. This is the merchant's own view, so floors are included.
 */
export async function GET(_req: Request, ctx: ShopCtx): Promise<Response> {
  try {
    const found = await shopFrom(ctx);
    if ("response" in found) return found.response;
    return json(200, { negotiations: await loadNegotiations(found.shop.slug) });
  } catch (err) {
    return failure(err, "console.negotiations");
  }
}
