import { loadSummary } from "@/lib/console/server/data";
import { merchantView } from "@/lib/console/server/session";
import { failure, json, shopFrom, type ShopCtx } from "../../_lib/http";

/**
 * Headline numbers for the Console header. Public: no floors, costs or
 * buyer details, plus whether this request holds a merchant session.
 */
export async function GET(req: Request, ctx: ShopCtx): Promise<Response> {
  try {
    const found = await shopFrom(ctx);
    if ("response" in found) return found.response;
    return json(200, { ...(await loadSummary(found.shop)), merchant: merchantView(req, found.shop.slug) });
  } catch (err) {
    return failure(err, "console.summary");
  }
}
