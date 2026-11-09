import { Channel3Mcp } from "./mcp";
import type { Channel3 } from "./port";
import { Channel3Rest } from "./rest";

export * from "./port";
export { Channel3Mcp, CHANNEL3_MCP_URL, connectChannel3Mcp, type Channel3McpOptions, type McpCaller, type McpToolResult } from "./mcp";
export { Channel3Rest, CHANNEL3_API_BASE, type Channel3RestOptions } from "./rest";

/** The REST API when `CHANNEL3_API_KEY` is set (higher limits, image search); the keyless MCP server otherwise. */
export function channel3FromEnv(env: Record<string, string | undefined> = process.env): Channel3 {
  const apiKey = env.CHANNEL3_API_KEY?.trim();
  return apiKey ? new Channel3Rest({ apiKey }) : new Channel3Mcp();
}
