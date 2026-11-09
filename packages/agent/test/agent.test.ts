import { afterEach, describe, expect, it } from "vitest";
import { runAgent, type AgentStep, type McpConnection } from "../src/index";
import {
  BIG_HEAD,
  BIG_TAIL,
  answer,
  call,
  connectFake,
  fakeShopServer,
  pingServer,
  scriptedModel,
  tools,
} from "./helpers";

const open: McpConnection[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

async function shop(opts: Parameters<typeof connectFake>[1] = {}) {
  const c = await connectFake(fakeShopServer(), opts);
  open.push(c);
  return c;
}

const base = { model: "test-model", system: "You are a shopping agent.", task: "Buy a mug.", maxSteps: 10 };

describe("runAgent", () => {
  it("calls tools until the model answers, and records each step", async () => {
    const { model } = scriptedModel([
      tools(call("search", { query: "sage mug" })),
      tools(call("add", { a: 2, b: 3 })),
      answer("Bought two sage mugs."),
    ]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop()] });

    expect(out.stoppedBy).toBe("answer");
    expect(out.finalText).toBe("Bought two sage mugs.");
    expect(out.steps.map((s) => [s.tool, s.args, s.resultText])).toEqual([
      ["search", { query: "sage mug" }, "found: sage mug"],
      ["add", { a: 2, b: 3 }, "5"],
    ]);
    expect(out.steps[0]!.structured).toEqual({ hits: ["sage mug"] });
    expect(out.steps.every((s) => s.isError === false && s.ms >= 0)).toBe(true);
  });

  it("sends the system prompt, the task and the tool results back to the model", async () => {
    const { model, requests } = scriptedModel([tools(call("search", { query: "mug" }, "c1")), answer("done")]);
    await runAgent({ ...base, llm: model, mcp: [await shop()], temperature: 0 });

    expect(requests[0]!.model).toBe("test-model");
    expect(requests[0]!.temperature).toBe(0);
    expect(requests[0]!.messages).toEqual([
      { role: "system", content: "You are a shopping agent." },
      { role: "user", content: "Buy a mug." },
    ]);
    const second = requests[1]!.messages;
    expect(second[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1", function: { name: "search" } }] });
    expect(second[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "found: mug" });
  });

  it("offers the MCP tools as functions and hides excluded ones", async () => {
    const { model, requests } = scriptedModel([answer("nothing to do")]);
    await runAgent({ ...base, llm: model, mcp: [await shop({ exclude: ["hidden"] })] });

    const offered = requests[0]!.tools!.map((t) => t.function.name).sort();
    expect(offered).toEqual(["add", "big", "boom", "search"]);
    const search = requests[0]!.tools!.find((t) => t.function.name === "search")!;
    expect(search.type).toBe("function");
    expect(search.function.description).toBe("Search the catalog");
    expect(search.function.parameters).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
    expect(requests[0]!.toolChoice).toBe("auto");
  });

  it("routes each tool to the server that owns it", async () => {
    const ping = await connectFake(pingServer(), { name: "ping" });
    open.push(ping);
    const { model } = scriptedModel([tools(call("ping", {}), call("add", { a: 1, b: 1 })), answer("ok")]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop(), ping] });

    expect(out.steps.map((s) => [s.server, s.tool, s.resultText])).toEqual([
      ["ping", "ping", "pong"],
      ["shop", "add", "2"],
    ]);
  });

  it("refuses two servers that offer the same tool name", async () => {
    const { model } = scriptedModel([answer("x")]);
    const a = await shop({ name: "a" });
    const b = await shop({ name: "b" });
    await expect(runAgent({ ...base, llm: model, mcp: [a, b] })).rejects.toThrow(/search.*a.*b/);
  });

  it("stops at maxSteps tool calls", async () => {
    const { model, requests } = scriptedModel(
      Array.from({ length: 10 }, () => tools(call("search", { query: "again" }))),
    );
    const out = await runAgent({ ...base, maxSteps: 3, llm: model, mcp: [await shop()] });

    expect(out.stoppedBy).toBe("max_steps");
    expect(out.steps).toHaveLength(3);
    expect(requests).toHaveLength(3);
    expect(out.finalText).toBe("");
  });

  it("does not run calls past the cap when one turn asks for several", async () => {
    const { model } = scriptedModel([
      tools(call("search", { query: "1" })),
      tools(call("search", { query: "2" }), call("search", { query: "3" })),
    ]);
    const out = await runAgent({ ...base, maxSteps: 2, llm: model, mcp: [await shop()] });

    expect(out.stoppedBy).toBe("max_steps");
    expect(out.steps.map((s) => s.args)).toEqual([{ query: "1" }, { query: "2" }]);
  });

  it("feeds tool errors back and keeps going", async () => {
    const { model, requests } = scriptedModel([tools(call("boom", {}, "b1")), answer("It failed, nothing bought.")]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop()] });

    expect(out.steps[0]).toMatchObject({ tool: "boom", isError: true, resultText: "it broke" });
    expect(requests[1]!.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "b1", content: "Error: it broke" });
    expect(out.stoppedBy).toBe("answer");
  });

  it("answers malformed arguments with an error instead of calling the tool", async () => {
    const { model, requests } = scriptedModel([tools(call("search", "{not json", "m1")), answer("gave up")]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop()] });

    expect(out.steps[0]).toMatchObject({ tool: "search", isError: true, args: "{not json" });
    expect(out.steps[0]!.resultText).toMatch(/not valid JSON/);
    expect(requests[1]!.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "m1" });
  });

  it("treats empty arguments as an empty object", async () => {
    const { model } = scriptedModel([tools(call("boom", "")), answer("x")]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop()] });
    expect(out.steps[0]).toMatchObject({ tool: "boom", args: {}, resultText: "it broke" });
  });

  it("answers an unknown tool with an error listing what exists", async () => {
    const { model } = scriptedModel([tools(call("teleport", {})), answer("x")]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop({ exclude: ["hidden"] })] });

    expect(out.steps[0]!.isError).toBe(true);
    expect(out.steps[0]!.resultText).toMatch(/Unknown tool teleport/);
    expect(out.steps[0]!.resultText).not.toMatch(/hidden/);
  });

  it("does not let the model call an excluded tool", async () => {
    const { model } = scriptedModel([tools(call("hidden", {})), answer("x")]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop({ exclude: ["hidden"] })] });
    expect(out.steps[0]).toMatchObject({ isError: true });
    expect(out.steps[0]!.resultText).not.toBe("secret");
  });

  it("sums usage and cost over every model call", async () => {
    const { model } = scriptedModel([
      { ...tools(call("add", { a: 1, b: 2 })), usage: { promptTokens: 1000, completionTokens: 50 }, costUsd: 0.01 },
      { ...answer("3"), usage: { promptTokens: 1200, completionTokens: 20 }, costUsd: 0.02 },
    ]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop()] });

    expect(out.usage).toEqual({ promptTokens: 2200, completionTokens: 70, calls: 2 });
    expect(out.costUsd).toBeCloseTo(0.03, 10);
  });

  it("prices calls from a rate card when the provider reports no cost", async () => {
    const { model } = scriptedModel([{ ...answer("x"), usage: { promptTokens: 1_000_000, completionTokens: 100_000 }, costUsd: undefined }]);
    const out = await runAgent({
      ...base,
      llm: model,
      mcp: [await shop()],
      pricing: { inputPerMTok: 2, outputPerMTok: 10 },
    });
    expect(out.costUsd).toBeCloseTo(3, 10);
  });

  it("returns stoppedBy error with the message when the model call fails", async () => {
    const { model } = scriptedModel([tools(call("add", { a: 1, b: 1 })), new Error("upstream 503")]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop()] });

    expect(out.stoppedBy).toBe("error");
    expect(out.error).toMatch(/upstream 503/);
    expect(out.steps).toHaveLength(1);
    expect(out.usage.calls).toBe(1);
  });

  it("stops with timeout when the run takes longer than its budget", async () => {
    let t = 0;
    const { model } = scriptedModel(Array.from({ length: 5 }, () => tools(call("add", { a: 1, b: 1 }))));
    const out = await runAgent({
      ...base,
      llm: model,
      mcp: [await shop()],
      timeoutMs: 2500,
      clock: () => (t += 1000),
    });
    expect(out.stoppedBy).toBe("timeout");
    expect(out.steps.length).toBeLessThan(5);
  });

  it("keeps reasoning blocks out of the final answer and the history", async () => {
    const { model, requests } = scriptedModel([
      { ...tools(call("add", { a: 1, b: 1 })), content: "<think>maybe add</think>Adding." },
      answer("<think>it is 2</think>\nThe answer is 2."),
    ]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop()] });

    expect(out.finalText).toBe("The answer is 2.");
    expect(requests[1]!.messages[2]).toMatchObject({ role: "assistant", content: "Adding." });
  });

  it("reports every step as it happens", async () => {
    const seen: AgentStep[] = [];
    const { model } = scriptedModel([tools(call("add", { a: 1, b: 1 })), tools(call("search", { query: "q" })), answer("x")]);
    await runAgent({ ...base, llm: model, mcp: [await shop()], onStep: (s) => void seen.push(s) });
    expect(seen.map((s) => s.tool)).toEqual(["add", "search"]);
  });

  it("shows the model a shortened huge output but keeps it whole in the trace", async () => {
    const { model, requests } = scriptedModel([tools(call("big", {}, "g1")), answer("x")]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop()], maxToolChars: 4000 });

    expect(out.steps[0]!.resultText.length).toBeGreaterThan(50_000);
    const seen = requests[1]!.messages.at(-1) as { content: string };
    expect(seen.content.length).toBeLessThanOrEqual(4200);
    expect(seen.content.startsWith(BIG_HEAD)).toBe(true);
    expect(seen.content.endsWith(BIG_TAIL)).toBe(true);
    expect(seen.content).toMatch(/characters omitted/);
  });

  it("elides large outputs once newer ones replace them, keeping the most recent", async () => {
    const { model, requests } = scriptedModel([
      tools(call("big", {}, "g1")),
      tools(call("big", {}, "g2")),
      tools(call("search", { query: "small" }, "s1")),
      tools(call("big", {}, "g3")),
      answer("x"),
    ]);
    await runAgent({
      ...base,
      llm: model,
      mcp: [await shop()],
      maxToolChars: 4000,
      keepRecentOutputs: 1,
      compactOverChars: 1000,
    });

    const last = requests[4]!.messages.filter((m) => m.role === "tool") as Array<{ tool_call_id: string; content: string }>;
    const byId = Object.fromEntries(last.map((m) => [m.tool_call_id, m.content]));
    expect(byId.g1).toMatch(/^\[Earlier output of big elided/);
    expect(byId.g2).toMatch(/^\[Earlier output of big elided/);
    expect(byId.s1).toBe("found: small");
    expect(byId.g3!.length).toBeGreaterThan(1000);
    // Once elided, an output stays elided, so the start of the history does not change between calls.
    const third = requests[3]!.messages.filter((m) => m.role === "tool") as Array<{ tool_call_id: string; content: string }>;
    expect(third.find((m) => m.tool_call_id === "g1")!.content).toBe(byId.g1);
  });

  it("rewrites tool text through the connection before the model sees it", async () => {
    const c = await shop({ transformText: (t) => t.toUpperCase() });
    const { model } = scriptedModel([tools(call("search", { query: "mug" })), answer("x")]);
    const out = await runAgent({ ...base, llm: model, mcp: [c] });
    expect(out.steps[0]!.resultText).toBe("FOUND: MUG");
  });

  it("returns the conversation it ran", async () => {
    const { model } = scriptedModel([tools(call("add", { a: 1, b: 1 })), answer("2")]);
    const out = await runAgent({ ...base, llm: model, mcp: [await shop()] });
    expect(out.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
  });
});
