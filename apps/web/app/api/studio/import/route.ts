import { importDrafts, MAX_PHOTO_BYTES, type ImportInput } from "@counter/importer";
import { z } from "zod";
import { json, requireMerchant } from "@/app/api/merchant/_lib/http";
import { loadShop } from "@/lib/server/runtime";
import { importDeps, ShopSlug, studioError } from "../_lib/studio";

// A product page lookup can take 10 s, then the model and a market search.
export const maxDuration = 60;

const MAX_CSV_CHARS = 1_000_000;

const JsonBody = z.union([
  z.object({ shop: ShopSlug, url: z.string().trim().url().max(2000) }),
  z.object({ shop: ShopSlug, csv: z.string().min(1).max(MAX_CSV_CHARS) }),
]);

type Parsed = { ok: true; shop: string; input: ImportInput } | { ok: false; response: Response };

const bad = (message: string): Parsed => ({ ok: false, response: json(400, { error: "invalid_request", message }) });

async function readMultipart(req: Request): Promise<Parsed> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Could not read the form upload");
  }
  const shop = ShopSlug.safeParse(form.get("shop"));
  if (!shop.success) return bad("Send the shop slug in the shop field");
  const photo = form.get("photo");
  if (photo instanceof File) {
    if (photo.size > MAX_PHOTO_BYTES) return bad(`Photos must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB`);
    return {
      ok: true,
      shop: shop.data,
      input: { photo: { bytes: new Uint8Array(await photo.arrayBuffer()), mime: photo.type, filename: photo.name.slice(0, 200) } },
    };
  }
  const csv = form.get("csv");
  const csvText = csv instanceof File ? await csv.text() : typeof csv === "string" ? csv : "";
  if (csvText) {
    if (csvText.length > MAX_CSV_CHARS) return bad("CSV pastes are limited to 1 MB");
    return { ok: true, shop: shop.data, input: { csv: csvText } };
  }
  const url = form.get("url");
  if (typeof url === "string" && url.trim()) return { ok: true, shop: shop.data, input: { url: url.trim() } };
  return bad("Send one of: a photo file, a csv field or file, or a url field");
}

async function readJson(req: Request): Promise<Parsed> {
  const parsed = JsonBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Send { shop, url } or { shop, csv } as JSON, or a multipart form with a photo file");
  const { shop, ...rest } = parsed.data;
  return { ok: true, shop, input: "url" in rest ? { url: rest.url } : { csv: rest.csv } };
}

/**
 * Turns a product page URL, a product photo or a CSV paste into catalog
 * drafts for the merchant to review: exact variants with attributes, prices
 * and stock, a Channel3 market check and a suggested negotiation floor.
 * Nothing is written; `POST /api/studio/publish` does that.
 */
export async function POST(req: Request): Promise<Response> {
  const denied = requireMerchant(req);
  if (denied) return denied;
  try {
    const multipart = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
    const body = multipart ? await readMultipart(req) : await readJson(req);
    if (!body.ok) return body.response;
    const shop = await loadShop(body.shop);
    if (!shop) return json(404, { error: "not_found", message: `No shop called ${body.shop}` });
    const drafts = await importDrafts(body.input, importDeps(shop));
    return json(200, { drafts });
  } catch (err) {
    return studioError(err, "studio.import");
  }
}
