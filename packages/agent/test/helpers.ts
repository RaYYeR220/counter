import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ChatModel, ChatRequest, ChatResponse, ToolCall } from "@counter/negotiate";
import { connectMcp, type McpConnection } from "../src/index";

export const BIG_HEAD = "### Page\n- Page URL: http://shop.test/p/mug\n";
export const BIG_TAIL = "- button \"Add to cart\" [ref=e99]\n";
/** About 150 000 characters of snapshot lines. */
const BIG_BODY = Array.from({ length: 5000 }, (_, i) => `- listitem "row ${i}" [ref=r${i}]\n`).join("");

/** A small MCP server with tools that cover the agent loop's paths. */
export function fakeShopServer(): McpServer {
  const server = new McpServer({ name: "fake-shop", version: "test" });
  server.registerTool(
    "search",
    {
      description: "Search the catalog",
      inputSchema: z.strictObject({ query: z.string().describe("What to look for") }),
    },
    async ({ query }) => ({
      content: [{ type: "text", text: `found: ${query}` }],
      structuredContent: { hits: [query] },
    }),
  );
  server.registerTool(
    "add",
    { description: "Add two numbers", inputSchema: z.strictObject({ a: z.number(), b: z.number() }) },
    async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
  );
  server.registerTool("boom", { description: "Always fails", inputSchema: z.strictObject({}) }, async () => ({
    content: [{ type: "text", text: "it broke" }],
    isError: true,
  }));
  server.registerTool("big", { description: "A huge page", inputSchema: z.strictObject({}) }, async () => ({
    content: [{ type: "text", text: BIG_HEAD + BIG_BODY + BIG_TAIL }],
  }));
  server.registerTool("hidden", { description: "Not for the agent", inputSchema: z.strictObject({}) }, async () => ({
    content: [{ type: "text", text: "secret" }],
  }));
  return server;
}

export function pingServer(): McpServer {
  const server = new McpServer({ name: "ping", version: "test" });
  server.registerTool("ping", { description: "Ping", inputSchema: z.strictObject({}) }, async () => ({
    content: [{ type: "text", text: "pong" }],
  }));
  return server;
}

export async function connectFake(
  server: McpServer,
  opts: { name?: string; exclude?: string[]; transformText?: (text: string) => string | Promise<string> } = {},
): Promise<McpConnection> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  return connectMcp(clientSide, { name: opts.name ?? "shop", ...opts });
}

export async function rawClient(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

type Scripted = Partial<ChatResponse> | Error | ((req: ChatRequest) => Partial<ChatResponse>);

/** A model that replays a fixed script and records every request it gets. */
export function scriptedModel(script: Scripted[]) {
  const requests: ChatRequest[] = [];
  const queue = [...script];
  const model: ChatModel = {
    async chat(req) {
      requests.push(structuredClone(req));
      const next = queue.shift();
      if (!next) throw new Error("script exhausted");
      if (next instanceof Error) throw next;
      const r = typeof next === "function" ? next(req) : next;
      return {
        model: req.model,
        content: null,
        toolCalls: [],
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 10 },
        costUsd: 0.001,
        latencyMs: 1,
        ...r,
      };
    },
  };
  return { model, requests };
}

let seq = 0;
export function call(name: string, args: unknown, id?: string): ToolCall {
  return {
    id: id ?? `call_${++seq}`,
    type: "function",
    function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
  };
}

export function tools(...calls: ToolCall[]): Partial<ChatResponse> {
  return { toolCalls: calls, finishReason: "tool_calls" };
}

export function answer(content: string): Partial<ChatResponse> {
  return { content, finishReason: "stop" };
}
