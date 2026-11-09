import type { FloorPolicy } from "./types";

/** Models the importer calls through the shared OpenAI-compatible chat client. */
export interface ImporterModels {
  /** Picks buyer-facing attributes, writes descriptions, normalises CSV headers. */
  text: string;
  /** Reads product photos (image_url data URIs). */
  vision: string;
}

export const DEFAULT_MODELS: ImporterModels = {
  text: "z-ai-glm-5-3-flash",
  vision: "z-ai-glm-5-3-flash",
};

export function modelsFromEnv(env: Record<string, string | undefined> = process.env): ImporterModels {
  return {
    text: env.COUNTER_IMPORTER_TEXT_MODEL || DEFAULT_MODELS.text,
    vision: env.COUNTER_IMPORTER_VISION_MODEL || DEFAULT_MODELS.vision,
  };
}

/** Used when no shop policy is given. */
export const DEFAULT_FLOOR_POLICY: FloorPolicy = { maxDiscountPct: 15 };
