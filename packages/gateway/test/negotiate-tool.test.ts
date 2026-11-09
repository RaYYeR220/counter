import { describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { JsonShopDirectory, registerCounterTools, StoreSyncClient, type Negotiator } from "../src/index";
import { loadSeed, SHOP_BASE } from "./harness";

async function connect(negotiator?: Negotiator) {
  const server = new McpServer({ name: "counter", version: "test" });
  registerCounterTools(server, {
    directory: new JsonShopDirectory(loadSeed()),
    storeSync: new StoreSyncClient({ baseUrl: () => SHOP_BASE, merchantIdFor: async () => "M", clientIdentifier: "test" }),
    orders: { approvalState: async () => ({ status: "UNKNOWN", approveUrl: "x" }) },
    publicBaseUrl: SHOP_BASE,
    ...(negotiator ? { negotiator } : {}),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

describe("negotiate tool", () => {
  it("is only offered when the shop has a seller agent", async () => {
    const without = await connect();
    expect((await without.listTools()).tools.map((t) => t.name)).not.toContain("negotiate");
    const withSeller = await connect({ haggle: async () => ({ reply: "List price.", verdict: "none" }) });
    expect((await withSeller.listTools()).tools.map((t) => t.name)).toContain("negotiate");
  });

  it("passes the request through and explains how to use the offer", async () => {
    const asked: unknown[] = [];
    const client = await connect({
      async haggle(req) {
        asked.push(req);
        return {
          reply: "Three mugs for $79.50 works.",
          verdict: "accept",
          offer: {
            offer_id: "OFF-ABCD1234",
            lines: [{ variant_id: "JC-MUG-SPECKLE-SAGE-8", quantity: 3, unit_price: "26.50", list_price: "30.00" }],
            discount: "10.50",
            expires_at: "2026-11-10T15:30:00.000Z",
          },
        };
      },
    });
    const r = (await client.callTool({
      name: "negotiate",
      arguments: { shop: "juniper-clay", items: [{ variant_id: "JC-MUG-SPECKLE-SAGE-8", quantity: 3 }], message: "Any deal on three?" },
    })) as { content: Array<{ text?: string }>; structuredContent?: Record<string, unknown> };
    const text = r.content.map((c) => c.text ?? "").join("\n");
    expect(asked).toEqual([{ shop: "juniper-clay", items: [{ variant_id: "JC-MUG-SPECKLE-SAGE-8", quantity: 3 }], message: "Any deal on three?" }]);
    expect(text).toContain("OFF-ABCD1234");
    expect(text).toContain("$26.50");
    expect(text).toContain("call create_cart (or update_cart) with offer_id OFF-ABCD1234");
    expect(r.structuredContent?.verdict).toBe("accept");
  });

  it("reports a failing seller as a tool error", async () => {
    const client = await connect({ haggle: async () => { throw new Error("model timeout"); } });
    const r = (await client.callTool({
      name: "negotiate",
      arguments: { shop: "juniper-clay", items: [{ variant_id: "JC-MUG-SPECKLE-SAGE-8", quantity: 1 }], message: "deal?" },
    })) as { isError?: boolean };
    expect(r.isError).toBe(true);
  });
});
