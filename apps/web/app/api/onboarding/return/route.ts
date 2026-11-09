import { completeOnboarding } from "@counter/platform";
import { db, paypal } from "@/lib/server/runtime";
import { errorResponse, json } from "@/app/api/merchant/_lib/http";

/**
 * GET /api/onboarding/return?shop=<slug>&merchantIdInPayPal=...&permissionsGranted=true
 * Where PayPal sends the shop owner after signup. The seller is confirmed with
 * PayPal by the shop's tracking id before anything is stored; the owner then
 * lands on the studio with `onboarding=active|pending|declined`.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("shop")?.trim();
    if (!slug) return json(400, { error: "invalid_request", message: "shop is required" });
    const studio = (state: string) =>
      Response.redirect(new URL(`/studio?shop=${encodeURIComponent(slug)}&onboarding=${state}`, url).toString(), 302);
    if (url.searchParams.get("permissionsGranted") === "false") return studio("declined");
    const merchantIdInPayPal = url.searchParams.get("merchantIdInPayPal")?.trim();
    const out = await completeOnboarding(db(), paypal(), { shopSlug: slug, ...(merchantIdInPayPal ? { merchantIdInPayPal } : {}) });
    return studio(out.status);
  } catch (err) {
    return errorResponse(err, "onboarding.return");
  }
}
