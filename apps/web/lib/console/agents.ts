import type { AgentFamily } from "./types";

/**
 * Which agent surface a `Client_Identifier` names. PayPal passes the
 * identifier through as the buyer's agent sends it, so match on what it
 * contains rather than an exact string.
 */
export function agentFamily(agent: string | null | undefined): AgentFamily {
  if (!agent) return "unknown";
  const a = agent.toLowerCase();
  if (a === "unattributed") return "unknown";
  if (a.includes("perplexity")) return "perplexity";
  if (a.includes("copilot")) return "copilot";
  if (a.includes("meta")) return "meta";
  if (a.includes("counter mcp") || a === "mcp" || a.includes("counter-mcp")) return "counter-mcp";
  if (a.includes("storefront")) return "storefront";
  return "other";
}

const LABELS: Record<AgentFamily, string> = {
  perplexity: "Perplexity",
  copilot: "Copilot",
  meta: "Meta AI",
  "counter-mcp": "Counter MCP",
  storefront: "Storefront",
  other: "Other agent",
  unknown: "Unattributed",
};

export function agentLabel(agent: string | null | undefined): string {
  const family = agentFamily(agent);
  return family === "other" && agent ? agent : LABELS[family];
}

/** Display order for agent surfaces, and the chart palette slot each one takes. */
export const AGENT_ORDER: AgentFamily[] = ["perplexity", "copilot", "meta", "counter-mcp", "storefront", "other", "unknown"];
