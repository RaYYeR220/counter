import { describe, expect, it } from "vitest";
import { PayPal } from "@counter/paypal";
import { approvalStatusOf, PayPalOrderLookup } from "../src/order-lookup";

function client(reply: { status: number; body: unknown }) {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (new URL(req.url).pathname === "/v1/oauth2/token") {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return new PayPal({ clientId: "c", clientSecret: "s", base: "https://api-m.sandbox.paypal.com" }, fetchImpl);
}
const shops = { merchantIdFor: async () => undefined };

describe("PayPalOrderLookup", () => {
  it("maps Orders v2 statuses", () => {
    expect(approvalStatusOf("PAYER_ACTION_REQUIRED")).toBe("CREATED");
    expect(approvalStatusOf("APPROVED")).toBe("APPROVED");
    expect(approvalStatusOf("COMPLETED")).toBe("COMPLETED");
    expect(approvalStatusOf("VOIDED")).toBe("UNKNOWN");
  });

  it("returns the payer once the buyer approved", async () => {
    const lookup = new PayPalOrderLookup(client({ status: 200, body: { id: "O1", status: "APPROVED", payer: { payer_id: "P1" } } }), shops);
    await expect(lookup.approvalState("juniper-clay", "O1")).resolves.toMatchObject({ status: "APPROVED", payerId: "P1" });
  });

  it("falls back to the sandbox approval URL and hides the payer before approval", async () => {
    const lookup = new PayPalOrderLookup(client({ status: 200, body: { id: "O2", status: "PAYER_ACTION_REQUIRED" } }), shops);
    const out = await lookup.approvalState("juniper-clay", "O2");
    expect(out.status).toBe("CREATED");
    expect(out.payerId).toBeUndefined();
    expect(out.approveUrl).toContain("checkoutnow?token=O2");
  });

  it("reports unknown orders without throwing", async () => {
    const lookup = new PayPalOrderLookup(client({ status: 404, body: { name: "RESOURCE_NOT_FOUND" } }), shops);
    await expect(lookup.approvalState("juniper-clay", "NOPE")).resolves.toMatchObject({ status: "UNKNOWN" });
  });
});
