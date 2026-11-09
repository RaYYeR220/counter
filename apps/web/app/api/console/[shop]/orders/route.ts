import { loadOrders } from "@/lib/console/server/data";
import { failure, json, requireMerchantView, shopFrom, type ShopCtx } from "../../_lib/http";

/** The shop's orders, newest first, with what each one is waiting on. Merchant session only. */
export async function GET(req: Request, ctx: ShopCtx): Promise<Response> {
  try {
    const found = await shopFrom(ctx);
    if ("response" in found) return found.response;
    const denied = requireMerchantView(req, found.shop);
    if (denied) return denied;
    return json(200, { orders: await loadOrders(found.shop.slug) });
  } catch (err) {
    return failure(err, "console.orders");
  }
}
