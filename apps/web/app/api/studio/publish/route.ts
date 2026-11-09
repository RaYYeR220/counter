import { publishDrafts } from "@counter/importer";
import { z } from "zod";
import { json, readBody, requireMerchant } from "@/app/api/merchant/_lib/http";
import { baseUrl, db } from "@/lib/server/runtime";
import { ProductDraftSchema, ShopSlug, studioError } from "../_lib/studio";

const Body = z.object({
  shop: ShopSlug,
  drafts: z.array(ProductDraftSchema).min(1).max(50),
});

/**
 * Writes reviewed drafts into the shop's catalog (`variants`), where agents
 * can find and buy them through Store Sync. Variant ids are
 * `<order prefix>-<product>-<options>`; publishing the same product again
 * updates it in place. Logs `catalog.published`.
 */
export async function POST(req: Request): Promise<Response> {
  const denied = requireMerchant(req);
  if (denied) return denied;
  try {
    const body = await readBody(req, Body);
    if (!body.ok) return body.response;
    const out = await publishDrafts(db(), body.data.shop, body.data.drafts, { publicBaseUrl: baseUrl() });
    return json(200, {
      products: out.products,
      variants: out.variants,
      created: out.created,
      updated: out.updated,
      variant_ids: out.variantIds,
    });
  } catch (err) {
    return studioError(err, "studio.publish");
  }
}
