import type { ProductDraft } from "@counter/importer";
import type { FloorSource } from "./floor";

/** A draft as Studio shows it: the import's draft plus, per variant, where its floor came from. */
export interface StudioDraft {
  draft: ProductDraft;
  /** Same order as `draft.variants`. */
  floorSources: FloorSource[];
}

export type ImportResult = { ok: true; drafts: StudioDraft[] } | { ok: false; message: string };

export type PublishResult =
  | { ok: true; products: number; variants: number; created: number; updated: number }
  | { ok: false; message: string; problems?: string[] };

export type ActionState = { ok: boolean; message: string } | null;

/** What the workbench needs to know about the shop. */
export interface StudioShop {
  slug: string;
  name: string;
  /** Test shops (`try-…`) take published products; demo shops keep their seeded catalog. */
  canPublish: boolean;
  maxDiscountPct: number;
}

export type { ProductDraft };
