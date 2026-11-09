import { describe, expect, it } from "vitest";
import { chatClient, LlmError, veniceClient, type ChatRequest } from "../src/llm";

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

function fakeFetch(responses: (Response | Error | "hang")[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    const next = queue.shift();
    if (!next) throw new Error("no more fake responses");
    if (next === "hang") {
      return new Promise<Response>((_, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
      });
    }
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const OK = json(200, {
  model: "test-model",
  choices: [
    {
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "propose_deal", arguments: '{"percent_off":10}' } }],
      },
    },
  ],
  usage: { prompt_tokens: 120, completion_tokens: 30 },
  cost: { usd: 0.0000391 },
});

const REQ: ChatRequest = {
  model: "test-model",
  messages: [
    { role: "system", content: "You sell mugs." },
    { role: "user", content: "Ten percent off?" },
  ],
  tools: [{ type: "function", function: { name: "propose_deal", description: "Propose", parameters: { type: "object" } } }],
  toolChoice: "required",
  maxTokens: 300,
  temperature: 0.2,
};

const noSleep = { sleeps: [] as number[], sleep: async function (this: void, ms: number) { noSleep.sleeps.push(ms); } };

describe("chatClient", () => {
  it("posts an OpenAI-compatible chat completion and reads tool calls, usage and cost", async () => {
    const f = fakeFetch([OK.clone()]);
    const llm = chatClient({ baseUrl: "https://llm.example/v1/", apiKey: "k-123", fetch: f.fn, extraBody: { vendor: { x: 1 } } });
    const res = await llm.chat(REQ);

    expect(f.calls).toHaveLength(1);
    const [call] = f.calls;
    expect(call!.url).toBe("https://llm.example/v1/chat/completions");
    expect(call!.init.method).toBe("POST");
    expect(new Headers(call!.init.headers).get("authorization")).toBe("Bearer k-123");
    expect(call!.body).toEqual({
      model: "test-model",
      messages: REQ.messages,
      tools: REQ.tools,
      tool_choice: "required",
      max_tokens: 300,
      temperature: 0.2,
      vendor: { x: 1 },
    });

    expect(res.content).toBeNull();
    expect(res.toolCalls).toEqual([{ id: "call_1", type: "function", function: { name: "propose_deal", arguments: '{"percent_off":10}' } }]);
    expect(res.finishReason).toBe("tool_calls");
    expect(res.usage).toEqual({ promptTokens: 120, completionTokens: 30 });
    expect(res.costUsd).toBeCloseTo(0.0000391);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("retries 429 and 5xx with growing backoff and honors Retry-After", async () => {
    noSleep.sleeps.length = 0;
    const f = fakeFetch([json(429, { error: "slow down" }, { "retry-after": "2" }), json(503, {}), OK.clone()]);
    const llm = chatClient({ baseUrl: "https://llm.example/v1", apiKey: "k", fetch: f.fn, retries: 3, backoffMs: 100, sleep: noSleep.sleep });
    const res = await llm.chat(REQ);
    expect(res.toolCalls).toHaveLength(1);
    expect(f.calls).toHaveLength(3);
    expect(noSleep.sleeps[0]).toBe(2000);
    expect(noSleep.sleeps[1]).toBeGreaterThanOrEqual(200);
  });

  it("gives up after the retry budget with the last status", async () => {
    const f = fakeFetch([json(500, {}), json(502, {}), json(500, { error: "down" })]);
    const llm = chatClient({ baseUrl: "https://llm.example/v1", apiKey: "k", fetch: f.fn, retries: 2, sleep: async () => {} });
    const err = await llm.chat(REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).status).toBe(500);
    expect(f.calls).toHaveLength(3);
  });

  it("does not retry a client error", async () => {
    const f = fakeFetch([json(400, { error: "bad tools" })]);
    const llm = chatClient({ baseUrl: "https://llm.example/v1", apiKey: "k", fetch: f.fn, retries: 3, sleep: async () => {} });
    const err = await llm.chat(REQ).catch((e: unknown) => e);
    expect((err as LlmError).status).toBe(400);
    expect((err as LlmError).message).toContain("bad tools");
    expect(f.calls).toHaveLength(1);
  });

  it("times out a hung request and retries it", async () => {
    const f = fakeFetch(["hang", OK.clone()]);
    const llm = chatClient({ baseUrl: "https://llm.example/v1", apiKey: "k", fetch: f.fn, timeoutMs: 20, retries: 1, sleep: async () => {} });
    const res = await llm.chat(REQ);
    expect(res.toolCalls).toHaveLength(1);
    expect(f.calls).toHaveLength(2);
  });

  it("retries network failures", async () => {
    const f = fakeFetch([new TypeError("fetch failed"), OK.clone()]);
    const llm = chatClient({ baseUrl: "https://llm.example/v1", apiKey: "k", fetch: f.fn, retries: 1, sleep: async () => {} });
    expect((await llm.chat(REQ)).toolCalls).toHaveLength(1);
  });

  it("rejects a response without a message", async () => {
    const f = fakeFetch([json(200, { choices: [] })]);
    const llm = chatClient({ baseUrl: "https://llm.example/v1", apiKey: "k", fetch: f.fn, retries: 0 });
    await expect(llm.chat(REQ)).rejects.toBeInstanceOf(LlmError);
  });
});

describe("veniceClient", () => {
  it("targets Venice and leaves out Venice's own system prompt", async () => {
    const f = fakeFetch([OK.clone()]);
    await veniceClient({ apiKey: "k", fetch: f.fn }).chat(REQ);
    expect(f.calls[0]!.url).toBe("https://api.venice.ai/api/v1/chat/completions");
    expect(f.calls[0]!.body.venice_parameters).toEqual({ include_venice_system_prompt: false });
  });
});
