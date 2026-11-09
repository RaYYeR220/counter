import { connectCounter, runAgent, type AgentStep } from "@counter/agent";
import { veniceClient } from "@counter/negotiate";
import { baseUrl } from "@/lib/server/runtime";

export const maxDuration = 120;

/** Model behind the playground's buyer agent. */
const BUYER_MODEL = process.env.COUNTER_BUYER_MODEL ?? "z-ai-glm-5-3-flash";
const MAX_STEPS = 16;
const MAX_TURN_CHARS = 1200;

const SYSTEM =
  "You are a shopping agent acting for the person chatting with you. You shop small independent shops through the " +
  "shop tools. Buy exactly what they ask for. If the exact item can't be bought, don't buy anything and say why, " +
  "offering the closest real alternatives the shop has. If they ask for a deal or name a price, call negotiate before " +
  "building the cart and pass their own words as the message, unchanged; the shop decides what it can do. When the cart matches the request, call checkout: the first time it returns an approve_url, tell the person " +
  "to approve the payment in PayPal at that link and stop. When they say they approved, call checkout again to place " +
  "the order. If no shipping address was given, use 1 Main St, Portland, OR 97205, US. Keep replies short and specific: " +
  "name the exact variant, the unit price and the total.";

type Turn = { from: "user" | "agent"; text: string };

// A small per-instance limiter: enough to keep one visitor from running up costs.
const recent = new Map<string, number[]>();
function allowed(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (hits.length >= 20) return false;
  hits.push(now);
  recent.set(ip, hits);
  return true;
}

function taskFrom(history: Turn[], message: string): string {
  const earlier = history
    .slice(-8)
    .map((t) => `${t.from === "user" ? "Person" : "You"}: ${t.text.slice(0, MAX_TURN_CHARS)}`)
    .join("\n");
  return earlier ? `Conversation so far:\n${earlier}\n\nPerson: ${message}` : message;
}

function stepView(s: AgentStep) {
  return {
    index: s.index,
    tool: s.tool,
    args: s.args,
    ok: !s.isError,
    ms: s.ms,
    text: s.resultText.length > 1500 ? `${s.resultText.slice(0, 1500)}…` : s.resultText,
    structured: s.structured ?? null,
  };
}

/**
 * Runs the playground's buyer agent against Counter's own MCP server and
 * streams every tool call as it happens (newline-delimited JSON).
 */
export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) return Response.json({ error: "The buyer agent is not configured." }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowed(ip)) return Response.json({ error: "Too many runs from this address. Try again in a few minutes." }, { status: 429 });

  let body: { message?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: { message, history? }" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_TURN_CHARS) : "";
  if (!message) return Response.json({ error: "Say what you want to buy." }, { status: 400 });
  const history = Array.isArray(body.history)
    ? (body.history as Turn[]).filter((t) => t && (t.from === "user" || t.from === "agent") && typeof t.text === "string")
    : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const counter = await connectCounter(`${baseUrl()}/mcp`, { exclude: [], callTimeoutMs: 45_000 }).catch((err: Error) => err);
      if (counter instanceof Error) {
        send({ type: "error", message: "Could not reach the shops right now." });
        controller.close();
        return;
      }
      try {
        send({ type: "start", model: BUYER_MODEL });
        const result = await runAgent({
          llm: veniceClient({ apiKey, timeoutMs: 45_000, retries: 2 }),
          model: BUYER_MODEL,
          system: SYSTEM,
          task: taskFrom(history, message),
          mcp: [counter],
          maxSteps: MAX_STEPS,
          temperature: 0,
          onStep: (step) => send({ type: "step", step: stepView(step) }),
        });
        const fallback: Record<string, string> = {
          max_steps: "I ran out of steps before finishing. Try a more specific request.",
          repeated_failure: "The shop kept returning the same error, so I stopped. Nothing was bought.",
          timeout: "That took too long, so I stopped. Nothing was bought.",
          error: "The buyer agent stopped unexpectedly. Nothing was bought.",
        };
        send({
          type: "final",
          text: result.finalText || fallback[result.stoppedBy] || "",
          stoppedBy: result.stoppedBy,
          steps: result.steps.length,
          costUsd: Number(result.costUsd.toFixed(5)),
        });
      } catch {
        send({ type: "error", message: "The buyer agent stopped unexpectedly. Try again." });
      } finally {
        await counter.close().catch(() => undefined);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
