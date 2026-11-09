import { createMcpHandler } from "mcp-handler";
import { COUNTER_INSTRUCTIONS, registerCounterTools } from "@counter/gateway";
import { baseUrl, negotiation, orderLookup, shopDirectory, storeSyncClient } from "@/lib/server/runtime";

/** Every MCP session shops as one agent client, so offers it negotiates apply to the carts it builds. */
const AGENT_CLIENT = "Counter MCP";

/**
 * Counter's MCP server. Any MCP client (desktop assistants, IDE agents, the
 * playground) shops the connected stores through these tools; every cart and
 * checkout goes through the shop's own Store Sync API, signed the way PayPal's
 * agentic commerce platform signs it.
 */
const handler = createMcpHandler(
  (server) => {
    registerCounterTools(server, {
      directory: shopDirectory(),
      storeSync: storeSyncClient(AGENT_CLIENT),
      negotiator: { haggle: (req) => negotiation().haggle({ ...req, agentClient: AGENT_CLIENT }) },
      // Built on first use, so discovery works even before payments are configured.
      orders: { approvalState: (shop, orderId) => orderLookup().approvalState(shop, orderId) },
      publicBaseUrl: baseUrl(),
      defaultCustomer: {
        name: { given_name: "Sandbox", surname: "Buyer" },
        email_address: process.env.DEMO_BUYER_EMAIL ?? "buyer@counter-demo.example",
      },
    });
  },
  {
    serverInfo: { name: "counter", version: "0.1.0" },
    instructions: COUNTER_INSTRUCTIONS,
    experimental_webMcp: { tools: ["list_shops", "search_products", "get_product", "negotiate", "create_cart", "update_cart", "checkout", "order_status"] },
  },
);

export { handler as GET, handler as POST, handler as DELETE };
