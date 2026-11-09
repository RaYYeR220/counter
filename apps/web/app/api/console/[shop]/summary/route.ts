import { loadSummary } from "@/lib/console/server/data";
import { failure, json, shopFrom, type ShopCtx } from "../../_lib/http";

/** Headline numbers for the Console header and the merchant-ops agent. */
export async function GET(_req: Request, ctx: ShopCtx): Promise<Response> {
  try {
    const found = await shopFrom(ctx);
    if ("response" in found) return found.response;
    return json(200, await loadSummary(found.shop));
  } catch (err) {
    return failure(err, "console.summary");
  }
}
