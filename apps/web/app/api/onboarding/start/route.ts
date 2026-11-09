import { getShop } from "@counter/db";
import { startOnboarding } from "@counter/platform";
import { baseUrl, db, paypal } from "@/lib/server/runtime";
import { errorResponse, json, requireMerchant } from "@/app/api/merchant/_lib/http";

/**
 * GET /api/onboarding/start?shop=<slug>[&email=<owner email>]
 * Sends the shop owner to PayPal to connect their PayPal account. Needs the
 * merchant key (header, or `key` query parameter for a plain link), so nobody
 * else can attach their PayPal account to the shop.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = requireMerchant(req, { allowQueryKey: true });
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("shop")?.trim();
    if (!slug) return json(400, { error: "invalid_request", message: "shop is required" });
    const shop = await getShop(db(), slug);
    if (!shop) return json(404, { error: "not_found", message: `No shop called ${slug}` });
    const email = url.searchParams.get("email")?.trim();
    const { actionUrl } = await startOnboarding(paypal(), {
      shopSlug: shop.slug,
      returnUrl: `${baseUrl()}/api/onboarding/return?shop=${encodeURIComponent(shop.slug)}`,
      ...(email ? { email } : {}),
    });
    return Response.redirect(actionUrl, 302);
  } catch (err) {
    return errorResponse(err, "onboarding.start");
  }
}
