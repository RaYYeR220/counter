import { respondToDispute } from "@counter/platform";
import { db, paypal, shopAccounts } from "@/lib/server/runtime";
import { errorResponse, json, requireMerchant } from "@/app/api/merchant/_lib/http";

type Ctx = { params: Promise<{ disputeId: string }> };

/**
 * Answers a PayPal dispute from the order's record: sends the evidence (with
 * a PDF of the order, the buying agent and the timeline) or accepts the claim.
 * A dispute is answered once; repeating the call returns the first answer.
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const denied = requireMerchant(req);
  if (denied) return denied;
  try {
    const { disputeId } = await ctx.params;
    const out = await respondToDispute(db(), paypal(), shopAccounts, disputeId);
    return json(200, {
      dispute_id: out.disputeId,
      order_id: out.orderId,
      action: out.decision.action,
      reason: out.decision.reason,
      evidence_type: out.decision.evidenceType,
      evidence_file: out.evidenceFile ?? null,
      already_responded: out.alreadyResponded,
    });
  } catch (err) {
    return errorResponse(err, "merchant.dispute.respond");
  }
}
