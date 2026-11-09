import { loadCatalog } from "@/lib/console/server/data";
import { failure, json, shopFrom, type ShopCtx } from "../../_lib/http";

/** The shop's variants with price, floor, stock and the last market check. */
export async function GET(_req: Request, ctx: ShopCtx): Promise<Response> {
  try {
    const found = await shopFrom(ctx);
    if ("response" in found) return found.response;
    return json(200, { variants: await loadCatalog(found.shop.slug) });
  } catch (err) {
    return failure(err, "console.catalog");
  }
}
