import { z } from "zod";
import { loadShop } from "@/lib/server/runtime";
import { LinesSchema, PartialAddressSchema, quoteCart, ShippingOptionSchema } from "@/lib/storefront/pricing";

const Body = z.object({
  lines: LinesSchema,
  shipping_address: PartialAddressSchema.optional(),
  shipping_option: ShippingOptionSchema.optional(),
});

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Prices a storefront cart with the Store Sync engine: line prices, stock
 * issues, shipping options with delivery dates, tax and total. Nothing is
 * stored and nothing goes to PayPal.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/storefront/[shop]/quote">) {
  const { shop: slug } = await ctx.params;
  const shop = await loadShop(slug);
  if (!shop) return json(404, { error: "not_found", message: `No shop called ${slug}` });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json(400, { error: "invalid_request", message: "Send lines: [{ variant_id, quantity }] and an optional US shipping_address." });
  }
  const { lines, shipping_address, shipping_option } = parsed.data;
  const quote = await quoteCart(shop.slug, { lines, address: shipping_address, shippingOption: shipping_option });
  return json(200, quote);
}
