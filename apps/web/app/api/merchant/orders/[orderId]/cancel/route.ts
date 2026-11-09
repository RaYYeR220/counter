import { Fulfilment } from "@counter/platform";
import { z } from "zod";
import { db, paypal, shopAccounts } from "@/lib/server/runtime";
import { errorResponse, json, readBody, requireMerchant } from "@/app/api/merchant/_lib/http";

type Ctx = { params: Promise<{ orderId: string }> };

const Body = z.object({ reason: z.string().trim().max(500).optional() });

/** Cancels an order that has not shipped: releases the buyer's hold and puts the items back in stock. */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const denied = requireMerchant(req);
  if (denied) return denied;
  try {
    const { orderId } = await ctx.params;
    const body = await readBody(req, Body);
    if (!body.ok) return body.response;
    const order = await new Fulfilment(db(), paypal(), shopAccounts).cancel(orderId, body.data.reason || "cancelled by the shop");
    return json(200, { order });
  } catch (err) {
    return errorResponse(err, "merchant.cancel");
  }
}
