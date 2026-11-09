import "server-only";
import type { Shop } from "@counter/db";
import {
  channel3FromEnv,
  Channel3Error,
  ImportError,
  modelsFromEnv,
  PublishError,
  type Channel3,
  type FloorPolicy,
  type ImportDeps,
} from "@counter/importer";
import { LlmError, veniceClient, type ChatModel } from "@counter/negotiate";
import { z } from "zod";
import { errorResponse, json } from "@/app/api/merchant/_lib/http";

// One Channel3 client per server process, so its URL lookup cache and rate
// spacing hold across requests.
let channel3Client: Channel3 | undefined;
export function channel3(): Channel3 {
  return (channel3Client ??= channel3FromEnv());
}

class ModelNotConfigured extends Error {}

let llmClient: ChatModel | undefined;
export function studioLlm(): ChatModel {
  if (!llmClient) {
    const apiKey = process.env.VENICE_API_KEY;
    if (!apiKey) throw new ModelNotConfigured("VENICE_API_KEY must be set for catalog imports");
    llmClient = veniceClient({ apiKey, timeoutMs: 45_000, retries: 2 });
  }
  return llmClient;
}

/** The shop's negotiation policy as the floor rule reads it: no negotiation means no discount. */
export function floorPolicy(shop: Pick<Shop, "policy">): FloorPolicy {
  const n = shop.policy.negotiation;
  return { maxDiscountPct: n?.enabled ? Math.max(0, n.max_discount_pct) : 0 };
}

export function importDeps(shop: Pick<Shop, "policy">): ImportDeps {
  return { channel3: channel3(), llm: studioLlm(), models: modelsFromEnv(), policy: floorPolicy(shop) };
}

export const ShopSlug = z.string().trim().min(1).max(80);

const VariantDraftSchema = z.object({
  variantId: z.string().max(120),
  attributes: z.record(z.string().max(64), z.string().max(200)),
  priceCents: z.number().int().min(0).max(10_000_000),
  stock: z.number().int().min(0).max(1_000_000),
  costCents: z.number().int().min(0).max(10_000_000).optional(),
  floorCents: z.number().int().min(0).max(10_000_000),
  flags: z.array(z.string().max(40)).max(20),
  purchasable: z.boolean(),
  leadTimeDays: z.number().int().min(0).max(365),
  weightG: z.number().int().min(0).max(1_000_000).optional(),
});

const MarketCheckSchema = z.object({
  comparable: z.array(z.object({ title: z.string(), merchant: z.string(), priceCents: z.number().int(), url: z.string() })).max(30),
  lowCents: z.number().int(),
  medianCents: z.number().int(),
  highCents: z.number().int(),
  position: z.enum(["below", "within", "above"]),
  priceCents: z.number().int().optional(),
  checkedAt: z.string(),
});

export const ProductDraftSchema = z.object({
  parentId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  description: z.string().max(4000),
  attributesOrder: z.array(z.string().max(64)).max(10),
  variants: z.array(VariantDraftSchema).min(1).max(100),
  source: z.object({
    kind: z.enum(["url", "photo", "csv"]),
    ref: z.string().max(2000).optional(),
    merchant: z.string().max(200).optional(),
  }),
  market: MarketCheckSchema.optional(),
  warnings: z.array(z.string().max(2000)).max(50),
});

/** Import, Channel3, model and publish failures as JSON answers; anything else goes to the merchant API's handler. */
export function studioError(err: unknown, where: string): Response {
  if (err instanceof ImportError) {
    const status = err.code === "invalid_input" ? 400 : err.code === "not_found" ? 404 : 422;
    return json(status, { error: err.code, message: err.message });
  }
  if (err instanceof PublishError) {
    return json(err.code === "shop_not_found" ? 404 : 422, { error: err.code, message: err.message, problems: err.problems });
  }
  if (err instanceof Channel3Error) {
    if (err.code === "rate_limited") return json(429, { error: "channel3_rate_limited", message: "Channel3 is busy; try again in a minute" });
    return json(502, { error: "channel3_unavailable", message: err.message });
  }
  if (err instanceof LlmError) return json(502, { error: "model_unavailable", message: "The model behind imports did not answer; try again" });
  if (err instanceof ModelNotConfigured) return json(503, { error: "model_not_configured", message: err.message });
  return errorResponse(err, where);
}
