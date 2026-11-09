import { resolved, type ImportDeps } from "./deps";
import { suggestFloor } from "./floor";
import { fromCsv } from "./from-csv";
import { fromPhoto, type PhotoInput } from "./from-photo";
import { fromUrl } from "./from-url";
import { marketCheck } from "./market";
import type { ProductDraft } from "./types";

export type ImportInput = { url: string } | { csv: string } | { photo: PhotoInput };

/**
 * Runs one import and adds a market check to each draft that does not have
 * one yet. Floors the import suggested are raised to the market rule; floors
 * a merchant typed in (a CSV floor column) are left alone. A failed market
 * check becomes a warning on that draft.
 */
export async function importDrafts(input: ImportInput, deps: ImportDeps, opts: { market?: boolean } = {}): Promise<ProductDraft[]> {
  const drafts =
    "url" in input ? [await fromUrl(input.url, deps)] : "csv" in input ? await fromCsv(input.csv, deps) : [await fromPhoto(input.photo, deps)];
  if (opts.market === false) return drafts;

  const { policy } = resolved(deps);
  for (const draft of drafts) {
    if (draft.market || draft.source.kind === "photo") continue;
    try {
      const market = await marketCheck(draft, deps);
      if (!market) continue;
      draft.market = market;
      for (const v of draft.variants) {
        if (v.floorCents === suggestFloor(v, undefined, policy)) v.floorCents = suggestFloor(v, market, policy);
      }
    } catch (err) {
      draft.warnings.push(`The market check failed (${err instanceof Error ? err.message : String(err)}); run it again later.`);
    }
  }
  return drafts;
}
