import { LlmError, type ChatMessage, type ChatModel } from "@counter/negotiate";

/** The first balanced `{...}` in a reply, parsed; tolerates code fences and prose around it. */
export function extractJson(text: string): Record<string, unknown> | undefined {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const v: unknown = JSON.parse(text.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch {
          // Try the next opening brace.
        }
        break;
      }
    }
  }
  return undefined;
}

export interface JsonAsk {
  model: string;
  system: string;
  user: string;
  /** Sent as an `image_url` data URI part next to the text. */
  image?: { bytes: Uint8Array; mime: string };
  maxTokens?: number;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/**
 * One chat completion that must answer with a JSON object. A reply without
 * one is asked for once more; a second miss throws.
 */
export async function askJson(llm: ChatModel, ask: JsonAsk): Promise<Record<string, unknown>> {
  const userContent = ask.image
    ? [
        { type: "text", text: ask.user },
        { type: "image_url", image_url: { url: `data:${ask.image.mime};base64,${toBase64(ask.image.bytes)}` } },
      ]
    : ask.user;
  // The shared chat client sends messages as given; OpenAI-compatible vision
  // models read content parts, which its text-only message type does not spell out.
  const messages = [
    { role: "system", content: ask.system },
    { role: "user", content: userContent },
  ] as ChatMessage[];
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.chat({ model: ask.model, messages, temperature: 0, maxTokens: ask.maxTokens ?? 900 });
    last = res.content ?? "";
    const parsed = extractJson(last);
    if (parsed) return parsed;
  }
  throw new LlmError(`The model did not answer with a JSON object: ${last.slice(0, 200)}`, 200);
}

/** Strings from an unknown JSON value; anything else is dropped. */
export function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
