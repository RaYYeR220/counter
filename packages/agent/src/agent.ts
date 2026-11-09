import type { ChatMessage, ChatModel, ToolCall, ToolSpec } from "@counter/negotiate";
import { toFunctionSpec, type McpConnection } from "./mcp";
import { shorten, stripReasoning } from "./text";

export interface AgentStep {
  /** 0-based position in the run. */
  index: number;
  /** Name of the MCP connection that ran the tool. */
  server: string;
  tool: string;
  /** Parsed arguments, or the raw string when the model sent invalid JSON. */
  args: unknown;
  /** The full tool output (the model may have seen a shortened copy). */
  resultText: string;
  isError: boolean;
  structured?: unknown;
  ms: number;
}

export type StoppedBy = "answer" | "max_steps" | "error" | "timeout" | "repeated_failure";

export interface AgentResult {
  finalText: string;
  steps: AgentStep[];
  usage: { promptTokens: number; completionTokens: number; calls: number };
  costUsd: number;
  stoppedBy: StoppedBy;
  error?: string;
  /** The conversation as last sent to the model, plus its final answer. */
  messages: ChatMessage[];
}

export interface RunAgentOptions {
  llm: ChatModel;
  model: string;
  system: string;
  task: string;
  mcp: readonly McpConnection[];
  /** Maximum tool calls in the run. */
  maxSteps: number;
  /** Stop after the same call fails this many times in a row with the same error. Default 3. */
  maxRepeatedFailures?: number;
  onStep?: (step: AgentStep) => void | Promise<void>;
  temperature?: number;
  maxTokens?: number;
  /** Longest tool output the model sees, in characters. Default 24 000. */
  maxToolChars?: number;
  /** How many of the latest large outputs stay in full. Default 2. */
  keepRecentOutputs?: number;
  /** Outputs longer than this count as large. Default 6 000 characters. */
  compactOverChars?: number;
  /** Wall-clock budget for the run. */
  timeoutMs?: number;
  /** Milliseconds clock for the timeout, injectable for tests. */
  clock?: () => number;
  /** Used when the provider does not report a cost. USD per million tokens. */
  pricing?: { inputPerMTok: number; outputPerMTok: number };
}

interface Route {
  conn: McpConnection;
  name: string;
}

async function toolIndex(mcp: readonly McpConnection[]): Promise<{ routes: Map<string, Route>; specs: ToolSpec[] }> {
  const routes = new Map<string, Route>();
  const specs: ToolSpec[] = [];
  for (const conn of mcp) {
    for (const tool of await conn.listTools()) {
      const taken = routes.get(tool.name);
      if (taken) throw new Error(`Tool ${tool.name} is offered by both ${taken.conn.name} and ${conn.name}`);
      routes.set(tool.name, { conn, name: tool.name });
      specs.push(toFunctionSpec(tool));
    }
  }
  return { routes, specs };
}

type ParsedArgs = { ok: true; args: Record<string, unknown> } | { ok: false; raw: string; message: string };

function parseArgs(raw: string): ParsedArgs {
  if (!raw.trim()) return { ok: true, args: {} };
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return { ok: true, args: v as Record<string, unknown> };
    return { ok: false, raw, message: "Arguments must be a JSON object." };
  } catch (e) {
    return { ok: false, raw, message: `Arguments are not valid JSON: ${(e as Error).message}` };
  }
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Runs one model against one or more MCP servers until it answers without a
 * tool call, runs out of steps or time, or the model call fails. Records every
 * tool call with its full output.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const maxToolChars = opts.maxToolChars ?? 24_000;
  const keepRecent = opts.keepRecentOutputs ?? 2;
  const largeOver = opts.compactOverChars ?? 6_000;
  const clock = opts.clock ?? Date.now;

  const { routes, specs } = await toolIndex(opts.mcp);
  const available = [...routes.keys()].sort().join(", ");

  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.task },
  ];
  const toolOf = new Map<string, string>();
  const steps: AgentStep[] = [];
  const usage = { promptTokens: 0, completionTokens: 0, calls: 0 };
  let costUsd = 0;
  let finalText = "";
  let stoppedBy: StoppedBy = "max_steps";
  let error: string | undefined;
  const started = clock();
  // The same call failing the same way, over and over, is a dead end: warn once, then stop.
  const maxRepeats = Math.max(2, opts.maxRepeatedFailures ?? 3);
  let lastFailure = "";
  let repeats = 0;

  /** Large outputs older than the most recent few become a one-line stub, and stay that way. */
  function compact(): void {
    const large = messages.filter(
      (m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool" && m.content.length > largeOver,
    );
    for (const m of large.slice(0, Math.max(0, large.length - keepRecent))) {
      m.content = `[Earlier output of ${toolOf.get(m.tool_call_id) ?? "a tool"} elided (${m.content.length} characters); newer results replace it.]`;
    }
  }

  async function execute(call: ToolCall): Promise<AgentStep> {
    const t0 = performance.now();
    const name = call.function.name;
    const route = routes.get(name);
    const parsed = parseArgs(call.function.arguments);
    const base = { index: steps.length, tool: name, server: route?.conn.name ?? "" };
    if (!route) {
      return { ...base, args: parsed.ok ? parsed.args : parsed.raw, resultText: `Unknown tool ${name}. Available tools: ${available}.`, isError: true, ms: performance.now() - t0 };
    }
    if (!parsed.ok) {
      return { ...base, args: parsed.raw, resultText: parsed.message, isError: true, ms: performance.now() - t0 };
    }
    try {
      const r = await route.conn.callTool(name, parsed.args);
      return {
        ...base,
        args: parsed.args,
        resultText: r.text,
        isError: r.isError,
        ...(r.structured !== undefined ? { structured: r.structured } : {}),
        ms: performance.now() - t0,
      };
    } catch (e) {
      return { ...base, args: parsed.args, resultText: `Tool call failed: ${errMessage(e)}`, isError: true, ms: performance.now() - t0 };
    }
  }

  loop: for (;;) {
    if (opts.timeoutMs !== undefined && clock() - started >= opts.timeoutMs) {
      stoppedBy = "timeout";
      break;
    }
    compact();
    let res;
    try {
      res = await opts.llm.chat({
        model: opts.model,
        messages,
        tools: specs,
        toolChoice: "auto",
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      });
    } catch (e) {
      stoppedBy = "error";
      error = errMessage(e);
      break;
    }
    usage.calls++;
    usage.promptTokens += res.usage.promptTokens;
    usage.completionTokens += res.usage.completionTokens;
    costUsd +=
      res.costUsd ??
      (opts.pricing
        ? (res.usage.promptTokens * opts.pricing.inputPerMTok + res.usage.completionTokens * opts.pricing.outputPerMTok) / 1e6
        : 0);

    const content = stripReasoning(res.content);
    if (!res.toolCalls.length) {
      finalText = content;
      stoppedBy = "answer";
      messages.push({ role: "assistant", content });
      break;
    }

    messages.push({ role: "assistant", content: content || null, tool_calls: res.toolCalls });
    let capped = false;
    for (const call of res.toolCalls) {
      toolOf.set(call.id, call.function.name);
      if (steps.length >= opts.maxSteps) {
        capped = true;
        messages.push({ role: "tool", tool_call_id: call.id, content: "Step limit reached; this call was not run." });
        continue;
      }
      const step = await execute(call);
      steps.push(step);
      await opts.onStep?.(step);
      let seen = step.isError ? `Error: ${step.resultText}` : step.resultText;
      if (step.isError) {
        const key = `${step.tool}|${JSON.stringify(step.args)}|${step.resultText}`;
        repeats = key === lastFailure ? repeats + 1 : 1;
        lastFailure = key;
      } else {
        repeats = 0;
        lastFailure = "";
      }
      if (repeats === maxRepeats - 1) {
        seen += `\n\nThis exact call has now failed ${repeats} times with the same error. Do not repeat it: tell the user what happened and what they can do instead.`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: shorten(seen, maxToolChars) });
      if (repeats >= maxRepeats) {
        stoppedBy = "repeated_failure";
        break loop;
      }
    }
    if (capped || steps.length >= opts.maxSteps) {
      stoppedBy = "max_steps";
      break loop;
    }
  }

  return { finalText, steps, usage, costUsd, stoppedBy, ...(error !== undefined ? { error } : {}), messages };
}
