import { disputes, negotiations, updateOrder, type Db, type Order } from "@counter/db";
import type { PayPalCart } from "@counter/store-sync";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PlatformError,
  buildEvidencePdf,
  decideDispute,
  loadAgentRequest,
  recordAgentRequest,
  respondToDispute,
  type AgentRequest,
  type EvidencePacket,
} from "../src/index";
import { SAGE_12, bookOrder, completedCart, dbShopAccounts, eventsOf, fakePayPal, orderRow, shopDb } from "./support";

const NOT_RECEIVED = { reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" };
const NOT_AS_DESCRIBED = { reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" };
const UNAUTHORISED = { reason: "UNAUTHORISED" };
const TRACKING = { carrier: "USPS", trackingNumber: "9400111899223197428490", shippedAt: "2026-11-02T15:00:00.000Z" };

function order(over: Partial<Order> = {}): Order {
  return {
    id: "JC-10001",
    shopId: "juniper-clay",
    cartId: "CART-TEST000001",
    paypalOrderId: "ORDER1",
    authorizationId: "AUTH1",
    captureId: "CAP1",
    payerId: "PAYER9",
    status: "captured",
    totalCents: 7399,
    platformFeeCents: 0,
    tracking: null,
    createdAt: new Date("2026-11-01T10:05:00Z"),
    updatedAt: new Date("2026-11-01T10:05:00Z"),
    ...over,
  };
}

const cart = completedCart();
const asked = (items: AgentRequest["items"]): AgentRequest => ({ items, source: "recorded" });

describe("decideDispute", () => {
  it("accepts an item-not-received claim for an order that never shipped", () => {
    const d = decideDispute(order(), cart, NOT_RECEIVED);
    expect(d).toMatchObject({ action: "accept", evidenceType: null });
  });

  it("fights an item-not-received claim with proof of fulfilment when the order shipped with tracking", () => {
    expect(decideDispute(order({ tracking: TRACKING }), cart, NOT_RECEIVED)).toMatchObject({
      action: "fight",
      evidenceType: "PROOF_OF_FULFILLMENT",
    });
  });

  it("uses tracking passed in the context", () => {
    expect(decideDispute(order(), cart, NOT_RECEIVED, { tracking: TRACKING }).action).toBe("fight");
  });

  it("fights not-as-described when the cart holds exactly what the agent asked for", () => {
    const request = asked([{ variant_id: SAGE_12.variantId, quantity: 2, selected_attributes: [{ name: "glaze", value: "Sage" }] }]);
    const d = decideDispute(order(), cart, NOT_AS_DESCRIBED, { request });
    expect(d).toMatchObject({ action: "fight", evidenceType: "OTHER" });
  });

  it("accepts not-as-described when the agent asked for a different attribute", () => {
    const request = asked([{ variant_id: SAGE_12.variantId, quantity: 2, selected_attributes: [{ name: "glaze", value: "cobalt" }] }]);
    const d = decideDispute(order(), cart, NOT_AS_DESCRIBED, { request });
    expect(d.action).toBe("accept");
    expect(d.reason).toContain("glaze");
  });

  it("accepts not-as-described when the quantities differ from the request", () => {
    const d = decideDispute(order(), cart, NOT_AS_DESCRIBED, { request: asked([{ variant_id: SAGE_12.variantId, quantity: 1 }]) });
    expect(d.action).toBe("accept");
  });

  it("accepts not-as-described when the agent asked for a variant the cart does not hold", () => {
    const d = decideDispute(order(), cart, NOT_AS_DESCRIBED, {
      request: asked([{ variant_id: SAGE_12.variantId, quantity: 2 }, { variant_id: "JC-MUG-SPECKLE-SAGE-8", quantity: 1 }]),
    });
    expect(d.action).toBe("accept");
  });

  it("reads the cart the agent confirmed at checkout as its request when none was recorded", () => {
    const d = decideDispute(order(), cart, NOT_AS_DESCRIBED);
    expect(d).toMatchObject({ action: "fight", evidenceType: "OTHER" });
  });

  it("fights an unauthorised claim when the payer approved the payment in PayPal", () => {
    expect(decideDispute(order(), cart, UNAUTHORISED)).toMatchObject({ action: "fight", evidenceType: "OTHER" });
    expect(decideDispute(order({ tracking: TRACKING }), cart, UNAUTHORISED)).toMatchObject({
      action: "fight",
      evidenceType: "PROOF_OF_FULFILLMENT",
    });
  });

  it("accepts an unauthorised claim when there is no PayPal payer approval on record", () => {
    expect(decideDispute(order({ payerId: null }), cart, UNAUTHORISED)).toMatchObject({ action: "accept", evidenceType: null });
  });

  it("answers any claim on an order that was already refunded with proof of refund", () => {
    for (const reason of [NOT_RECEIVED, NOT_AS_DESCRIBED, UNAUTHORISED, { reason: "CREDIT_NOT_PROCESSED" }]) {
      expect(decideDispute(order({ status: "refunded" }), cart, reason)).toMatchObject({ action: "fight", evidenceType: "PROOF_OF_REFUND" });
    }
  });

  it("fights other reasons only with a shipment to show", () => {
    expect(decideDispute(order(), cart, { reason: "DUPLICATE_TRANSACTION" }).action).toBe("accept");
    expect(decideDispute(order({ tracking: TRACKING }), cart, { reason: "DUPLICATE_TRANSACTION" })).toMatchObject({
      action: "fight",
      evidenceType: "PROOF_OF_FULFILLMENT",
    });
  });
});

function packet(over: Partial<EvidencePacket> = {}): EvidencePacket {
  return {
    shopName: "Juniper Clay",
    orderId: "JC-10001",
    disputeId: "PP-D-21",
    disputeReason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    decision: { action: "fight", reason: "Shipped with USPS", evidenceType: "PROOF_OF_FULFILLMENT" },
    paypal: { orderId: "ORDER1", authorizationId: "AUTH1", captureId: "CAP1", payerId: "PAYER9" },
    totalCents: 7399,
    currency: "USD",
    lines: [{ name: SAGE_12.name, variantId: SAGE_12.variantId, quantity: 2, unitPrice: "34.00", attributes: SAGE_12.attributes }],
    agent: { clientIdentifier: "Counter MCP" },
    request: asked([{ variant_id: SAGE_12.variantId, quantity: 2 }]),
    negotiation: null,
    timeline: [
      { label: "Cart created", at: "2026-11-01T10:00:00.000Z" },
      { label: "Payment authorized", at: "2026-11-01T10:05:00.000Z" },
    ],
    tracking: TRACKING,
    shipTo: "1 Main St, Portland, OR 97205, US",
    generatedAt: "2026-11-09T04:00:00.000Z",
    ...over,
  };
}

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("buildEvidencePdf", () => {
  it("writes a PDF 1.4 file that names the order and ends with %%EOF", () => {
    const text = latin1(buildEvidencePdf(packet()));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("JC-10001");
    expect(text).toContain("CAP1");
    expect(text).toContain("9400111899223197428490");
    expect(text).toContain("Counter MCP");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("has a cross-reference table that points at every object", () => {
    const text = latin1(buildEvidencePdf(packet()));
    const startxref = Number(/startxref\s+(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n\s*$/gm)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThan(4);
    entries.forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it("flows a long negotiation onto a second page", () => {
    const turns = Array.from({ length: 40 }, (_, i) => ({ from: i % 2 ? "seller" : "buyer", text: `Turn ${i}: could you do a little better on two mugs?` }));
    const text = latin1(buildEvidencePdf(packet({ negotiation: { outcome: "accept", finalUnitCents: 3100, turns } })));
    expect(text).toContain("/Count 2");
  });

  it("encodes typographic dashes for Helvetica and escapes PDF string delimiters", () => {
    const bytes = buildEvidencePdf(packet({ shopName: "Juniper (Clay) \\ Co" }));
    const text = latin1(bytes);
    expect(text).toContain("Juniper \\(Clay\\) \\\\ Co");
    expect(bytes.includes(0x97)).toBe(true); // the em dash in the variant name, in WinAnsi
  });
});

describe("agent requests", () => {
  let db: Db;
  beforeEach(async () => {
    db = await shopDb();
  });

  it("keeps the variant ids, quantities and attributes the agent sent, latest first", async () => {
    await recordAgentRequest(db, { shopId: "juniper-clay", cartId: "CART-1", agentClient: "Counter MCP", body: { items: [{ variant_id: "A", quantity: 1 }] } });
    await recordAgentRequest(db, {
      shopId: "juniper-clay",
      cartId: "CART-1",
      agentClient: "Counter MCP",
      body: JSON.stringify({
        items: [{ variant_id: SAGE_12.variantId, quantity: 2, price: { value: "1.00" }, selected_attributes: [{ name: "glaze", value: "sage" }] }],
        customer: { email_address: "buyer@example.com" },
      }),
    });
    const req = await loadAgentRequest(db, "juniper-clay", "CART-1");
    expect(req).toMatchObject({
      source: "recorded",
      agentClient: "Counter MCP",
      items: [{ variant_id: SAGE_12.variantId, quantity: 2, selected_attributes: [{ name: "glaze", value: "sage" }] }],
    });
    const [ev] = await eventsOf(db, "cart.request");
    expect(JSON.stringify(ev!.payload)).not.toContain("buyer@example.com");
  });

  it("ignores bodies without items", async () => {
    await recordAgentRequest(db, { shopId: "juniper-clay", cartId: "CART-2", body: "{not json" });
    await recordAgentRequest(db, { shopId: "juniper-clay", cartId: "CART-2", body: { payment_method: { token: "X" } } });
    expect(await loadAgentRequest(db, "juniper-clay", "CART-2")).toBeNull();
  });
});

describe("respondToDispute", () => {
  let db: Db;
  beforeEach(async () => {
    db = await shopDb();
  });

  async function disputed(over: { tracking?: boolean; reason?: string; cart?: ReturnType<typeof completedCart> } = {}) {
    const { order } = await bookOrder(db, over.cart ? { cart: over.cart } : {});
    await updateOrder(db, order.id, { status: "disputed", captureId: "CAP1", ...(over.tracking ? { tracking: TRACKING } : {}) });
    await db.insert(disputes).values({
      id: "PP-D-21",
      shopId: "juniper-clay",
      orderId: order.id,
      status: "OPEN",
      reason: over.reason ?? "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    });
    return order;
  }

  function paypal(reason = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") {
    return fakePayPal({
      "GET /v1/customer/disputes/PP-D-21": {
        json: {
          dispute_id: "PP-D-21",
          reason,
          status: "WAITING_FOR_SELLER_RESPONSE",
          disputed_transactions: [{ seller_transaction_id: "CAP1" }],
          allowed_response_options: { accept_claim: { accept_claim_types: ["REFUND", "REFUND_WITH_RETURN"] } },
        },
      },
      "POST /v1/customer/disputes/PP-D-21/provide-evidence": { json: { links: [] } },
      "POST /v1/customer/disputes/PP-D-21/accept-claim": { json: { links: [] } },
    });
  }

  it("fights with the tracking number and a PDF of the order when the order shipped", async () => {
    const o = await disputed({ tracking: true });
    const pp = paypal();
    const out = await respondToDispute(db, pp.client, dbShopAccounts(db), "PP-D-21", { now: () => new Date("2026-11-09T04:00:00Z") });

    expect(out.decision).toMatchObject({ action: "fight", evidenceType: "PROOF_OF_FULFILLMENT" });
    const [call] = pp.callsTo("POST", "/v1/customer/disputes/PP-D-21/provide-evidence");
    const form = await call!.formData();
    const input = JSON.parse(form.get("input") as string);
    expect(input.evidences[0]).toMatchObject({
      evidence_type: "PROOF_OF_FULFILLMENT",
      evidence_info: { tracking_info: [{ carrier_name: "USPS", tracking_number: TRACKING.trackingNumber }] },
    });
    const file = form.get("file1") as File;
    expect(file.name).toBe(`evidence-${o.id}.pdf`);
    const pdf = latin1(new Uint8Array(await file.arrayBuffer()));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain(o.id);

    const [row] = await db.select().from(disputes).where(eq(disputes.id, "PP-D-21"));
    expect(row).toMatchObject({ decision: "fight", status: "UNDER_REVIEW" });
    expect(row!.evidence).toHaveLength(1);
    expect(await eventsOf(db, "dispute.evidence_submitted", "PP-D-21")).toHaveLength(1);
  });

  it("puts the agent's request and the negotiation in the PDF for a not-as-described claim", async () => {
    const c = completedCart();
    (c.cart as PayPalCart).discounts = { applied: [{ code: "OFF-7Q2M4K9X", amount: { currency_code: "USD", value: "6.00" } }] } as PayPalCart["discounts"];
    await disputed({ reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", cart: c });
    await recordAgentRequest(db, { shopId: "juniper-clay", cartId: c.id, agentClient: "Counter MCP", body: { items: [{ variant_id: SAGE_12.variantId, quantity: 2 }] } });
    await db.insert(negotiations).values({
      shopId: "juniper-clay",
      agentClient: "Counter MCP",
      variantId: SAGE_12.variantId,
      transcript: [
        { from: "buyer", text: "Two sage mugs for 62?" },
        { from: "seller", text: "I can do 31 each.", offerId: "OFF-7Q2M4K9X" },
      ],
      outcome: "accept",
      finalUnitCents: 3100,
      floorCents: 2800,
    });
    const pp = paypal("MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED");
    const out = await respondToDispute(db, pp.client, dbShopAccounts(db), "PP-D-21");

    expect(out.decision).toMatchObject({ action: "fight", evidenceType: "OTHER" });
    const form = await pp.callsTo("POST", "/v1/customer/disputes/PP-D-21/provide-evidence")[0]!.formData();
    const pdf = latin1(new Uint8Array(await (form.get("file1") as File).arrayBuffer()));
    expect(pdf).toContain("Two sage mugs for 62?");
    expect(pdf).toContain("glaze: sage");
    expect(JSON.parse(form.get("input") as string).evidences[0].notes).toContain(SAGE_12.variantId);
  });

  it("accepts the claim for an order that never shipped and marks it refunded", async () => {
    const o = await disputed();
    const pp = paypal();
    const out = await respondToDispute(db, pp.client, dbShopAccounts(db), "PP-D-21");

    expect(out.decision.action).toBe("accept");
    const [call] = pp.callsTo("POST", "/v1/customer/disputes/PP-D-21/accept-claim");
    expect(call!.json()).toMatchObject({ accept_claim_type: "REFUND", note: expect.any(String) });
    expect(pp.callsTo("POST", "/v1/customer/disputes/PP-D-21/provide-evidence")).toHaveLength(0);
    expect((await orderRow(db, o.id))!.status).toBe("refunded");
    const [row] = await db.select().from(disputes).where(eq(disputes.id, "PP-D-21"));
    expect(row).toMatchObject({ decision: "accept", status: "RESOLVED" });
    expect(await eventsOf(db, "dispute.accepted", "PP-D-21")).toHaveLength(1);
  });

  it("does not answer the same dispute twice", async () => {
    await disputed({ tracking: true });
    const pp = paypal();
    await respondToDispute(db, pp.client, dbShopAccounts(db), "PP-D-21");
    const again = await respondToDispute(db, pp.client, dbShopAccounts(db), "PP-D-21");
    expect(again).toMatchObject({ alreadyResponded: true, decision: { action: "fight" } });
    expect(pp.callsTo("POST", "/v1/customer/disputes")).toHaveLength(1);
  });

  it("answers not_found for an unknown dispute and conflict for one not matched to an order", async () => {
    const pp = paypal();
    const missing = await respondToDispute(db, pp.client, dbShopAccounts(db), "PP-D-404").catch((e: unknown) => e);
    expect((missing as PlatformError).code).toBe("not_found");

    await db.insert(disputes).values({ id: "PP-D-9", shopId: "juniper-clay", orderId: null, status: "OPEN" });
    const loose = await respondToDispute(db, pp.client, dbShopAccounts(db), "PP-D-9").catch((e: unknown) => e);
    expect((loose as PlatformError).code).toBe("conflict");
  });
});
