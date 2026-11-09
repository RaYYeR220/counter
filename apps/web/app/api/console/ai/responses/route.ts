import { consoleAiModels, VENICE_RESPONSES_URL } from "@/lib/console/ai-config";
import { allow, clientIp, sameOrigin } from "../../_lib/http";

// The Console assistant's model calls. Studio's agents run in the browser and
// send one OpenAI Responses request per turn here; this adds the server's
// Venice key, keeps the model to the allowed list, caps the output, limits how
// many turns one visitor can run, and streams Venice's SSE answer straight back.

export const maxDuration = 120;

const MAX_OUTPUT_TOKENS = 8_000;
const MAX_BODY_BYTES = 1_500_000;
/** One question is usually 4 to 15 turns across the lead and its delegates. */
const TURNS_PER_WINDOW = 80;
const WINDOW_MS = 10 * 60_000;

const error = (status: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ error: { message } }, { status, headers: { "cache-control": "no-store", ...headers } });

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) return error(503, "The assistant isn't configured on this deployment.");
  if (!sameOrigin(req)) return error(403, "The assistant can only be used from the Console.");
  if (!allow(`ai:${clientIp(req)}`, TURNS_PER_WINDOW, WINDOW_MS)) {
    return error(429, "The assistant has answered a lot from this address in the last few minutes; try again shortly.", { "retry-after": "60" });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return error(413, "The conversation is too long; start a new one.");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return error(400, "Request body must be JSON.");
  }

  const models = consoleAiModels();
  const model = typeof body.model === "string" && body.model ? body.model : models[0]!;
  if (!models.includes(model)) return error(400, `Model "${model}" is not enabled.`);

  let upstream: Response;
  try {
    upstream = await fetch(VENICE_RESPONSES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...body, model, max_output_tokens: MAX_OUTPUT_TOKENS }),
      signal: req.signal,
    });
  } catch (err) {
    if (req.signal.aborted) return error(499, "Cancelled.");
    console.error("console.ai", err);
    return error(502, "The model provider didn't answer; try again.");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
