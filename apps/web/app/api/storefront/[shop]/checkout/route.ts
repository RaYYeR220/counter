import { fmt } from "@counter/store-sync";
import { cookies } from "next/headers";
import { z } from "zod";
import { loadShop } from "@/lib/server/runtime";
import { BENCH_COOKIE, benchRunId, recordBenchCheckout } from "@/lib/storefront/bench";
import { paymentsConfigured, startCheckout } from "@/lib/storefront/checkout";
import { FullAddressSchema, LinesSchema, quoteCart, ShippingOptionSchema } from "@/lib/storefront/pricing";
import type { CheckoutResponse } from "@/lib/storefront/types";

const Body = z.object({
  lines: LinesSchema,
  shipping_address: FullAddressSchema,
  customer: z.object({
    given_name: z.string().trim().min(1, "Enter a first name").max(140),
    surname: z.string().trim().min(1, "Enter a last name").max(140),
  }),
  shipping_option: ShippingOptionSchema.default("STANDARD"),
});

function reply(status: number, body: CheckoutResponse): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * "Checkout with PayPal" for the storefront. Prices the cart; a valid cart
 * becomes a Store Sync cart with a PayPal order and the buyer is sent to
 * PayPal to approve it. During a benchmark run (harness cookie plus
 * BENCH_KEY) the cart is recorded instead and PayPal is never called.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/storefront/[shop]/checkout">) {
  const { shop: slug } = await ctx.params;
  const shop = await loadShop(slug);
  if (!shop) return reply(404, { status: "error", message: "This shop doesn't exist." });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return reply(400, {
      status: "error",
      message: first?.message && !first.message.startsWith("Invalid") ? first.message : "Check your cart and shipping address, then try again.",
    });
  }
  const { lines, shipping_address, customer, shipping_option } = parsed.data;
  const request = { lines, address: shipping_address, shippingOption: shipping_option, customer };

  const quote = await quoteCart(shop.slug, request);
  if (quote.validation_status !== "VALID") {
    return reply(409, {
      status: "invalid",
      message: "Some items in your cart can't be bought as they are. Update your cart and try again.",
      issues: quote.issues,
    });
  }

  const runId = benchRunId((await cookies()).get(BENCH_COOKIE)?.value);
  if (runId) {
    const selected = quote.shipping_options.find((o) => o.is_selected);
    const saved = await recordBenchCheckout({
      runId,
      shop: shop.slug,
      lines: lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity })),
      shipping_address,
      shipping_option,
      total: fmt(quote.total_cents),
      validation_status: quote.validation_status,
      source: "storefront",
      summary: {
        lines: quote.lines.map((l) => ({
          variant_id: l.variant_id,
          name: l.name,
          quantity: l.quantity,
          unit_cents: l.unit_cents,
          line_cents: l.line_cents,
        })),
        subtotal_cents: quote.subtotal_cents,
        discount_cents: quote.discount_cents,
        shipping: selected
          ? { id: selected.id, name: selected.name, price_cents: selected.price_cents, estimated_delivery: selected.estimated_delivery }
          : null,
        tax_cents: quote.tax_cents,
        total_cents: quote.total_cents,
      },
    });
    return reply(200, {
      status: "bench",
      message: "Checkout started — handing off to PayPal",
      total_cents: quote.total_cents,
      handoff_url: `/s/${encodeURIComponent(shop.slug)}/checkout/handoff?ref=${saved.id}`,
    });
  }

  if (!paymentsConfigured()) {
    return reply(503, {
      status: "not_configured",
      message: "Payments are not configured for this shop yet, so checkout can't continue. Nothing was charged, and your cart is saved.",
    });
  }

  try {
    const started = await startCheckout(shop.slug, request);
    if (started.ok) return reply(200, { status: "redirect", approval_url: started.approvalUrl, cart_id: started.cartId });
    if (started.kind === "invalid") {
      return reply(409, { status: "invalid", message: "Some items in your cart can't be bought as they are.", issues: started.issues });
    }
    return reply(502, { status: "error", message: started.message });
  } catch (err) {
    console.error("storefront checkout failed", err);
    return reply(502, { status: "error", message: "Checkout couldn't reach PayPal. Nothing was charged; try again in a minute." });
  }
}
