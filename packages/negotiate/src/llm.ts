/**
 * A small client for OpenAI-compatible chat completion APIs with function
 * calling. Uses fetch only. Retries rate limits, server errors, timeouts and
 * network failures with exponential backoff.
 */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required" | "none";
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  model: string;
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | undefined;
  usage: { promptTokens: number; completionTokens: number };
  /** Reported by providers that price each call, such as Venice. */
  costUsd: number | undefined;
  latencyMs: number;
}

/** Anything that can answer a chat request. The seller agent depends on this, not on a vendor. */
export interface ChatModel {
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class LlmError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

export interface ChatClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  /** Per attempt. Default 60 s. */
  timeoutMs?: number;
  /** Extra attempts after the first. Default 3. */
  retries?: number;
  /** First backoff; doubles on each retry. Default 500 ms. */
  backoffMs?: number;
  /** Vendor-specific fields merged into every request body. */
  extraBody?: Record<string, unknown>;
  sleep?: (ms: number) => Promise<void>;
}

const retryable = (status: number) => status === 429 || status >= 500;

function retryAfterMs(res: Response): number | undefined {
  const v = res.headers.get("retry-after");
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

export function chatClient(opts: ChatClientOptions): ChatModel {
  const doFetch = opts.fetch ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const retries = opts.retries ?? 3;
  const backoffMs = opts.backoffMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function attempt(body: string): Promise<{ res: Response; text: string; ms: number }> {
    const started = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new LlmError(`Timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
        body,
        signal: ctrl.signal,
      });
      const text = await res.text();
      return { res, text, ms: performance.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async chat(req) {
      const body = JSON.stringify({
        model: req.model,
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        ...(req.toolChoice && req.tools?.length ? { tool_choice: req.toolChoice } : {}),
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...opts.extraBody,
      });

      let lastError: unknown;
      for (let i = 0; i <= retries; i++) {
        let wait = backoffMs * 2 ** i;
        try {
          const { res, text, ms } = await attempt(body);
          if (res.ok) return parse(text, req.model, ms);
          lastError = new LlmError(`Chat completion failed with ${res.status}: ${text.slice(0, 500)}`, res.status);
          if (!retryable(res.status)) throw lastError;
          wait = retryAfterMs(res) ?? wait;
        } catch (e) {
          if (e instanceof LlmError && e.status !== undefined && !retryable(e.status)) throw e;
          lastError = e;
        }
        if (i < retries) await sleep(wait);
      }
      throw lastError instanceof LlmError ? lastError : new LlmError(`Chat completion failed: ${String(lastError)}`);
    },
  };
}

function parse(text: string, model: string, latencyMs: number): ChatResponse {
  let data: {
    model?: string;
    choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    cost?: { usd?: number };
  };
  try {
    data = JSON.parse(text);
  } catch {
    throw new LlmError(`Chat completion returned invalid JSON: ${text.slice(0, 200)}`, 200);
  }
  const choice = data.choices?.[0];
  if (!choice?.message) throw new LlmError("Chat completion returned no message", 200);
  return {
    model: data.model ?? model,
    content: choice.message.content ?? null,
    toolCalls: (choice.message.tool_calls ?? []).map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.function.name, arguments: c.function.arguments ?? "" },
    })),
    finishReason: choice.finish_reason,
    usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 },
    costUsd: typeof data.cost?.usd === "number" ? data.cost.usd : undefined,
    latencyMs,
  };
}

export const VENICE_BASE_URL = "https://api.venice.ai/api/v1";

/** Venice AI's OpenAI-compatible endpoint, without Venice's own system prompt. */
export function veniceClient(opts: Omit<ChatClientOptions, "baseUrl"> & { baseUrl?: string }): ChatModel {
  return chatClient({
    ...opts,
    baseUrl: opts.baseUrl ?? VENICE_BASE_URL,
    extraBody: { venice_parameters: { include_venice_system_prompt: false }, ...opts.extraBody },
  });
}
