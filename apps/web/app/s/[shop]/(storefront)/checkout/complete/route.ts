import { connection } from "next/server";
import { loadShop } from "@/lib/server/runtime";
import { completeCheckout, paymentsConfigured } from "@/lib/storefront/checkout";

function goTo(req: Request, path: string): Response {
  return Response.redirect(new URL(path, req.url), 303);
}

/**
 * PayPal sends the buyer here after they approve the payment
 * (`?token=<PayPal order id>&PayerID=...`). Authorizes the payment through
 * Store Sync's checkout, books the order and shows it; any problem lands back
 * on the cart with an explanation.
 */
export async function GET(req: Request, ctx: RouteContext<"/s/[shop]/checkout/complete">) {
  await connection();
  const { shop: slug } = await ctx.params;
  const shop = await loadShop(slug);
  if (!shop) return goTo(req, "/");
  const cart = `/s/${encodeURIComponent(shop.slug)}/cart`;

  const url = new URL(req.url);
  const token = url.searchParams.get("token")?.trim();
  if (!token) return goTo(req, `${cart}?checkout=missing`);
  if (!paymentsConfigured()) return goTo(req, `${cart}?checkout=not_configured`);

  try {
    const result = await completeCheckout(shop.slug, token, url.searchParams.get("PayerID"));
    if (result.ok) {
      return goTo(req, `/s/${encodeURIComponent(shop.slug)}/orders/${encodeURIComponent(result.orderNumber)}?placed=1`);
    }
    return goTo(req, `${cart}?checkout=${result.reason}`);
  } catch (err) {
    console.error("storefront checkout completion failed", err);
    return goTo(req, `${cart}?checkout=error`);
  }
}
