import { loadNegotiations } from "@/lib/console/server/data";
import { failure, json, requireMerchantView, shopFrom, type ShopCtx } from "../../_lib/http";

/**
 * Every price negotiation a buyer agent had with the shop's seller agent,
 * newest first, with transcripts and floors. Merchant session only.
 */
export async function GET(req: Request, ctx: ShopCtx): Promise<Response> {
  try {
    const found = await shopFrom(ctx);
    if ("response" in found) return found.response;
    const denied = requireMerchantView(req, found.shop);
    if (denied) return denied;
    return json(200, { negotiations: await loadNegotiations(found.shop.slug) });
  } catch (err) {
    return failure(err, "console.negotiations");
  }
}
