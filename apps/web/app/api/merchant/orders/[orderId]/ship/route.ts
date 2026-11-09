import { Fulfilment } from "@counter/platform";
import { z } from "zod";
import { db, paypal, shopAccounts } from "@/lib/server/runtime";
import { errorResponse, json, readBody, requireMerchant } from "@/app/api/merchant/_lib/http";

type Ctx = { params: Promise<{ orderId: string }> };

const Body = z.object({
  carrier: z.string().trim().min(1).max(100),
  trackingNumber: z.string().trim().min(1).max(100),
});

/**
 * Ships an order: captures the buyer's authorized payment (with the platform
 * fee for shops paid to their own PayPal account) and adds the tracking number
 * to the PayPal order. Safe to repeat; a shipped order answers with its capture.
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const denied = requireMerchant(req);
  if (denied) return denied;
  try {
    const { orderId } = await ctx.params;
    const body = await readBody(req, Body);
    if (!body.ok) return body.response;
    const out = await new Fulfilment(db(), paypal(), shopAccounts).ship(orderId, body.data);
    return json(200, {
      order: out.order,
      capture_id: out.captureId,
      platform_fee_cents: out.platformFeeCents,
      already_shipped: out.alreadyShipped,
    });
  } catch (err) {
    return errorResponse(err, "merchant.ship");
  }
}
