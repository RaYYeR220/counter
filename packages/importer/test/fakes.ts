import type { ChatModel, ChatRequest, ChatResponse } from "@counter/negotiate";
import type { C3Product, C3SearchRequest, Channel3 } from "../src/channel3/port";

export type Script = string | ((req: ChatRequest) => string);

/** A chat model that answers from a script, in order, and records every request. */
export function scriptedLlm(script: Script[]) {
  const requests: ChatRequest[] = [];
  const queue = [...script];
  const llm: ChatModel = {
    async chat(req): Promise<ChatResponse> {
      requests.push(req);
      const next = queue.shift();
      if (next === undefined) throw new Error("scripted LLM ran out of replies");
      const content = typeof next === "function" ? next(req) : next;
      return {
        model: req.model,
        content,
        toolCalls: [],
        finishReason: "stop",
        usage: { promptTokens: 0, completionTokens: 0 },
        costUsd: undefined,
        latencyMs: 1,
      };
    },
  };
  return { llm, requests, remaining: () => queue.length };
}

/** A model that must not be called. */
export const noLlm: ChatModel = {
  async chat() {
    throw new Error("the LLM should not be called here");
  },
};

/** Channel3 backed by fixed data: products by URL and by id, and search results by query substring. */
export function fakeChannel3(data: {
  byUrl?: Record<string, C3Product>;
  byId?: Record<string, C3Product>;
  search?: Array<{ match: RegExp; products: C3Product[] }>;
  imageSearch?: boolean;
}) {
  const searches: C3SearchRequest[] = [];
  const lookups: string[] = [];
  const fetched: string[][] = [];
  const c3: Channel3 = {
    kind: "mcp",
    imageSearch: data.imageSearch ?? false,
    async search(req) {
      searches.push(req);
      const hit = data.search?.find((s) => s.match.test(req.query ?? ""));
      return (hit?.products ?? []).slice(0, req.limit ?? 8);
    },
    async lookup(url) {
      lookups.push(url);
      return data.byUrl?.[url] ?? null;
    },
    async products(ids) {
      fetched.push(ids);
      return ids.map((id) => data.byId?.[id]).filter((p): p is C3Product => Boolean(p));
    },
  };
  return { c3, searches, lookups, fetched };
}

export const offer = (domain: string, price: number, url = `https://buy.trychannel3.com/x-${domain}?o=1&aid=2`) => ({
  url,
  domain,
  price: { price, currency: "USD", compare_at_price: null },
  availability: "InStock",
});
