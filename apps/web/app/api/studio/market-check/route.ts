import { refreshMarket } from "@counter/importer";
import { z } from "zod";
import { json, readBody, requireMerchant } from "@/app/api/merchant/_lib/http";
import { db, loadShop } from "@/lib/server/runtime";
import { channel3, ShopSlug, studioError } from "../_lib/studio";

// One Channel3 search per product asked about.
export const maxDuration = 60;

const Body = z.object({
  shop: ShopSlug,
  variantIds: z.array(z.string().trim().min(1).max(120)).min(1).max(200),
});

/**
 * Re-checks what other merchants charge for the given variants (one
 * Channel3 search per product) and stores the result in `variants.market`,
 * with each variant's own position against the range.
 */
export async function POST(req: Request): Promise<Response> {
  const denied = requireMerchant(req);
  if (denied) return denied;
  try {
    const body = await readBody(req, Body);
    if (!body.ok) return body.response;
    const shop = await loadShop(body.data.shop);
    if (!shop) return json(404, { error: "not_found", message: `No shop called ${body.data.shop}` });
    const out = await refreshMarket(db(), shop.id, body.data.variantIds, { channel3: channel3() });
    return json(200, { checked: out.checked, updated: out.updated, missing: out.missing, no_comparables: out.noComparables });
  } catch (err) {
    return studioError(err, "studio.market-check");
  }
}
