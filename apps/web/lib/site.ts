// Site-wide constants for the public pages: where Counter lives and the links
// every surface points at. Fill a value here once and every page follows.

/** The public deployment people connect their agents to. */
export const PUBLIC_ORIGIN = "https://counter-agents.vercel.app";

/** Counter's source repository. Left as a placeholder until the public URL is final. */
export const GITHUB_URL = "https://github.com/RaYYeR220/counter";

/** Demo shop the merchant surfaces open by default. */
export const DEMO_SHOP = "juniper-clay";

export const VIDEO_URL = "https://youtu.be/GWyws_b6Yck";

export const LINKS = {
  playground: "/playground",
  studio: `/studio?shop=${DEMO_SHOP}`,
  console: `/console?shop=${DEMO_SHOP}`,
  storefront: `/s/${DEMO_SHOP}`,
  mcp: "/mcp",
  conformance: "/docs/store-sync-conformance",
  liveVerification: "/docs/live-verification",
} as const;

/** The MCP client config shown to people connecting an agent. */
export const MCP_CONFIG = { mcpServers: { counter: { url: `${PUBLIC_ORIGIN}${LINKS.mcp}` } } } as const;

/**
 * Test counts from the last full `pnpm -r test` run (README, "Testing").
 * Update them with the README when the suite changes.
 */
export const TEST_COUNTS = {
  total: 923,
  conformancePassed: 166,
  conformanceExpectedFailures: 3,
} as const;
