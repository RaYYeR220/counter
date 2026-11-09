import { ImportError, resolved, type ImportDeps } from "./deps";
import { suggestFloor } from "./floor";
import { askJson, strings } from "./llm";
import { marketCheck, positionOf } from "./market";
import { assignVariantIds } from "./rows";
import { attributeKey, keepSupportedSentences, slug } from "./text";
import type { ProductDraft, VariantDraft } from "./types";

export interface PhotoInput {
  bytes: Uint8Array;
  /** image/jpeg, image/png, image/webp or image/gif. */
  mime: string;
  filename?: string;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
/** Larger photos are refused; phone photos fit after the browser's own compression. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_ATTRIBUTES = 5;

const SYSTEM = `You look at one product photo for a small shop's catalog. Reply with one JSON object only:
{"name":"<short plain product name>","category":"<one or two words, plural, lowercase>","description":"<one or two sentences about what is visible>","attributes":[{"name":"<snake_case attribute a buyer would choose or filter on>","value":"<what you see>","confidence":"high|medium|low"}],"uncertain":["<things a buyer would ask that the photo cannot show>"],"search_query":"<a few words to find comparable products>"}
Describe only what is visible: shape, colour, finish, pattern, visible material. A photo cannot show capacity, exact size, weight, care instructions or where it was made: put those in "uncertain" and never state them as fact. Use "high" confidence only when there is no doubt. At most ${MAX_ATTRIBUTES} attributes.`;

/**
 * A draft from a product photo. The vision model names what it sees, with a
 * confidence for each attribute; anything short of high confidence, and
 * anything a photo cannot show, becomes a warning. Channel3 then finds
 * comparable products (by text, and by the photo itself when the REST API
 * key is set) and the market median is offered as a starting price.
 */
export async function fromPhoto(photo: PhotoInput, deps: ImportDeps): Promise<ProductDraft> {
  const { models, policy } = resolved(deps);
  if (!IMAGE_TYPES.has(photo.mime)) throw new ImportError("Upload a JPEG, PNG, WebP or GIF photo.", "invalid_input");
  if (!photo.bytes.byteLength || photo.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new ImportError(`Photos must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`, "invalid_input");
  }

  const seen = await askJson(deps.llm, {
    model: models.vision,
    system: SYSTEM,
    user: "What product is this? Answer in the JSON format described.",
    image: { bytes: photo.bytes, mime: photo.mime },
    maxTokens: 700,
  });
  const name = typeof seen.name === "string" ? seen.name.trim().slice(0, 120) : "";
  if (!name) throw new ImportError("The photo could not be read as a product. Try a clearer photo of a single item.", "unreadable");

  const warnings: string[] = ["Read from a photo: check the name, category and attributes before publishing."];
  const attributes: Record<string, string> = {};
  for (const a of Array.isArray(seen.attributes) ? seen.attributes : []) {
    if (!a || typeof a !== "object") continue;
    const { name: rawName, value: rawValue, confidence } = a as Record<string, unknown>;
    const key = typeof rawName === "string" ? attributeKey(rawName).slice(0, 32) : "";
    const value = typeof rawValue === "string" ? rawValue.trim().slice(0, 60) : "";
    if (!key || !value || key in attributes || Object.keys(attributes).length >= MAX_ATTRIBUTES) continue;
    attributes[key] = value;
    if (confidence !== "high") {
      warnings.push(`${key.replace(/_/g, " ")} “${value}” was read from the photo (${typeof confidence === "string" ? confidence : "unsure"} confidence): check it.`);
    }
  }
  for (const doubt of strings(seen.uncertain).slice(0, 6)) warnings.push(`Not visible in the photo: ${doubt.trim()}.`);

  // Numbers read off a photo are guesses, so any sentence stating one is left out.
  const written = typeof seen.description === "string" ? seen.description.trim() : "";
  const checked = keepSupportedSentences(written, "");
  const description = checked.text || `${name}.`;
  warnings.push("Add material, size or capacity and care to the description: a photo cannot show them.");

  const variant: VariantDraft = {
    variantId: "",
    attributes,
    priceCents: 0,
    stock: 0,
    floorCents: 0,
    flags: [],
    purchasable: true,
    leadTimeDays: 0,
  };
  const category = typeof seen.category === "string" && seen.category.trim() ? seen.category.trim().toLowerCase().slice(0, 40) : "general";
  const draft: ProductDraft = {
    parentId: slug(name, 32) || "ITEM",
    name,
    category,
    description,
    attributesOrder: Object.keys(attributes),
    variants: [variant],
    source: { kind: "photo", ...(photo.filename ? { ref: photo.filename } : {}) },
    warnings,
  };

  try {
    const query = typeof seen.search_query === "string" ? seen.search_query : undefined;
    const imageBase64 = Buffer.from(photo.bytes.buffer, photo.bytes.byteOffset, photo.bytes.byteLength).toString("base64");
    const market = await marketCheck(draft, deps, { ...(query ? { query } : {}), imageBase64 });
    if (market) {
      variant.priceCents = market.medianCents;
      draft.market = { ...market, priceCents: market.medianCents, position: positionOf(market.medianCents, market) };
      warnings.push(`Price set to $${(market.medianCents / 100).toFixed(2)}, the market median of ${market.comparable.length} comparable products: set your own.`);
    } else {
      warnings.push("No comparable products found: set a price before publishing.");
    }
  } catch (err) {
    warnings.push(`The market check failed (${err instanceof Error ? err.message : String(err)}): set a price before publishing.`);
  }
  variant.floorCents = suggestFloor(variant, draft.market, policy);
  warnings.push("Stock is unknown: set stock before publishing.");
  assignVariantIds(draft, "").forEach((id, i) => (draft.variants[i]!.variantId = id));
  return draft;
}
