import type { ChatModel } from "@counter/negotiate";
import type { Channel3 } from "./channel3/port";
import { DEFAULT_FLOOR_POLICY, DEFAULT_MODELS, type ImporterModels } from "./config";
import type { FloorPolicy } from "./types";

export interface ImportDeps {
  channel3: Channel3;
  llm: ChatModel;
  models?: Partial<ImporterModels>;
  /** The shop's negotiation policy, for suggested floors. */
  policy?: FloorPolicy;
  now?: () => Date;
}

export function resolved(deps: Pick<ImportDeps, "models" | "policy" | "now">) {
  return {
    models: { ...DEFAULT_MODELS, ...deps.models },
    policy: deps.policy ?? DEFAULT_FLOOR_POLICY,
    now: deps.now ?? (() => new Date()),
  };
}

/** An import that cannot produce a draft, with a reason the merchant can act on. */
export class ImportError extends Error {
  override readonly name = "ImportError";

  constructor(
    message: string,
    readonly code: "invalid_input" | "not_found" | "not_a_product_page" | "unreadable",
  ) {
    super(message);
  }
}
