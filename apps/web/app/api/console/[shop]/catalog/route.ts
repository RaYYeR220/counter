import { loadCatalog } from "@/lib/console/server/data";
import { failure, json, requireMerchantView, shopFrom, type ShopCtx } from "../../_lib/http";

/** The shop's variants with price, cost, floor, stock and the last market check. Merchant session only. */
export async function GET(req: Request, ctx: ShopCtx): Promise<Response> {
  try {
    const found = await shopFrom(ctx);
    if ("response" in found) return found.response;
    const denied = requireMerchantView(req, found.shop);
    if (denied) return denied;
    return json(200, { variants: await loadCatalog(found.shop.slug) });
  } catch (err) {
    return failure(err, "console.catalog");
  }
}
