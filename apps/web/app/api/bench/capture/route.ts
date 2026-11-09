import { fmt } from "@counter/store-sync";
import { connection } from "next/server";
import { z } from "zod";
import { loadShop } from "@/lib/server/runtime";
import { benchGate, isRunId, listBenchCheckouts, recordBenchCheckout } from "@/lib/storefront/bench";
import { LinesSchema, PartialAddressSchema, quoteCart, ShippingOptionSchema } from "@/lib/storefront/pricing";

const Body = z.object({
  runId: z.string().refine(isRunId, "runId must be 1-100 letters, digits, '.', '_', ':' or '-'"),
  shop: z.string().min(1).max(100),
  lines: LinesSchema,
  shipping_address: PartialAddressSchema,
  shipping_option: ShippingOptionSchema.optional(),
});

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Records a benchmark checkout: what the shopper would have paid for, in place
 * of a PayPal order. The total is recomputed by the pricing engine. The
 * storefront's own "Checkout with PayPal" writes the same record server-side
 * when the harness cookie is set.
 */
export async function POST(req: Request) {
  const denied = benchGate(req);
  if (denied) return denied;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json(400, { error: "invalid_request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  const { runId, lines, shipping_address, shipping_option } = parsed.data;
  const shop = await loadShop(parsed.data.shop);
  if (!shop) return json(404, { error: "not_found", message: `No shop called ${parsed.data.shop}` });

  const quote = await quoteCart(shop.slug, { lines, address: shipping_address, shippingOption: shipping_option });
  const capture = {
    runId,
    shop: shop.slug,
    lines,
    shipping_address,
    shipping_option: shipping_option ?? "STANDARD",
    total: quote.tax_pending ? null : fmt(quote.total_cents),
    validation_status: quote.validation_status,
    source: "api" as const,
  };
  const saved = await recordBenchCheckout(capture);
  return json(201, { ok: true, id: saved.id, at: saved.at, ...capture });
}

/** Every checkout captured for a run, oldest first: `GET /api/bench/capture?runId=...[&shop=...]`. */
export async function GET(req: Request) {
  await connection();
  const denied = benchGate(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");
  if (!isRunId(runId)) return json(400, { error: "invalid_request", message: "Pass ?runId=<the run id set in the counter_bench_run cookie>" });
  const shop = url.searchParams.get("shop") ?? undefined;
  const captures = await listBenchCheckouts(runId, shop);
  return json(200, { runId, count: captures.length, captures });
}
