import { Fulfilment } from "@counter/platform";
import { z } from "zod";
import { db, paypal, shopAccounts } from "@/lib/server/runtime";
import { errorResponse, json, readBody, requireMerchant } from "@/app/api/merchant/_lib/http";

type Ctx = { params: Promise<{ orderId: string }> };

const Body = z.object({ amountCents: z.number().int().positive().optional() });

/** Refunds a shipped order, in full or `amountCents` of it. */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const denied = requireMerchant(req);
  if (denied) return denied;
  try {
    const { orderId } = await ctx.params;
    const body = await readBody(req, Body);
    if (!body.ok) return body.response;
    const out = await new Fulfilment(db(), paypal(), shopAccounts).refund(orderId, body.data.amountCents);
    return json(200, {
      order: out.order,
      refund_id: out.refundId,
      amount_cents: out.amountCents,
      already_refunded: out.alreadyRefunded,
    });
  } catch (err) {
    return errorResponse(err, "merchant.refund");
  }
}
