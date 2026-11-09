// Models the Console's assistant may use, served by Venice's OpenAI-compatible
// Responses endpoint. `CONSOLE_AI_MODELS` (comma-separated) overrides the list;
// the first entry is the default.

export const VENICE_RESPONSES_URL = "https://api.venice.ai/api/v1/responses";

const DEFAULT_MODELS = ["openai-gpt-6-luna", "openai-gpt-61-terra"];

export function consoleAiModels(env: Record<string, string | undefined> = process.env): string[] {
  const list = (env.CONSOLE_AI_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_MODELS;
}

/** Display names for the model picker. */
export function modelLabel(id: string): string {
  const known: Record<string, string> = {
    "openai-gpt-6-luna": "Fast",
    "openai-gpt-61-terra": "Thorough",
  };
  return known[id] ?? id;
}
