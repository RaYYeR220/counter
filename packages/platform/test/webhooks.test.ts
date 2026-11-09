import { DbOrderSink, disputes, getShop, updateOrder, type Db, type Order } from "@counter/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SIMULATOR_WEBHOOK_ID, StockKeepingOrderSink, handlePayPalWebhook } from "../src/index";
import { MERCHANT, SAGE_12, bookOrder, eventsOf, fakePayPal, onboard, orderRow, shopDb, stockOf } from "./support";

const HEADERS = {
  "PayPal-Auth-Algo": "SHA256withRSA",
  "PayPal-Cert-Url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42",
  "PayPal-Transmission-Id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "PayPal-Transmission-Sig": "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==",
  "PayPal-Transmission-Time": "2026-11-09T04:10:00Z",
};

function delivery(type: string, resource: object, id = `WH-${type}`) {
  return JSON.stringify({
    id,
    event_version: "1.0",
    create_time: "2026-11-09T04:10:00.000Z",
    resource_type: type.split(".")[1]!.toLowerCase(),
    event_type: type,
    summary: `${type} summary`,
    resource,
  });
}

/** Delivered through PayPal's webhook simulator, which signs nothing. */
function simulated(db: Db, rawBody: string) {
  return handlePayPalWebhook(db, undefined, { headers: {}, rawBody, webhookId: SIMULATOR_WEBHOOK_ID });
}

let db: Db;
beforeEach(async () => {
  db = await shopDb();
});

async function capturedOrder(captureId = "CAP1"): Promise<Order> {
  const { order } = await bookOrder(db);
  return (await updateOrder(db, order.id, { status: "captured", captureId }))!;
}

describe("handlePayPalWebhook: delivery checks", () => {
  it("rejects a delivery whose signature PayPal does not confirm", async () => {
    const pp = fakePayPal({ "POST /v1/notifications/verify-webhook-signature": { json: { verification_status: "FAILURE" } } });
    const out = await handlePayPalWebhook(db, pp.client, {
      headers: HEADERS,
      rawBody: delivery("PAYMENT.CAPTURE.COMPLETED", { id: "CAP1" }),
      webhookId: "8PT597110X687430LKGECATA",
    });

    expect(out).toMatchObject({ ok: false, handled: "bad_signature" });
    const verify = pp.calls()[0]!.json();
    expect(verify).toMatchObject({ webhook_id: "8PT597110X687430LKGECATA", transmission_id: HEADERS["PayPal-Transmission-Id"] });
    expect(await eventsOf(db, "paypal.PAYMENT.CAPTURE.COMPLETED")).toHaveLength(0);
  });

  it("processes a delivery PayPal verifies", async () => {
    const pp = fakePayPal({ "POST /v1/notifications/verify-webhook-signature": { json: { verification_status: "SUCCESS" } } });
    const out = await handlePayPalWebhook(db, pp.client, {
      headers: HEADERS,
      rawBody: delivery("CHECKOUT.ORDER.APPROVED", { id: "ORDER-X" }, "WH-1"),
      webhookId: "8PT597110X687430LKGECATA",
    });
    expect(out).toMatchObject({ ok: true, eventId: "WH-1" });
    const [row] = await eventsOf(db, "paypal.CHECKOUT.ORDER.APPROVED");
    expect(row!.payload).toMatchObject({ event_id: "WH-1" });
    expect(row!.payload.unverified).toBeUndefined();
  });

  it("refuses to process a signed delivery when there is no PayPal client to verify it", async () => {
    const out = await handlePayPalWebhook(db, undefined, {
      headers: HEADERS,
      rawBody: delivery("CHECKOUT.ORDER.APPROVED", { id: "ORDER-X" }),
      webhookId: "8PT597110X687430LKGECATA",
    });
    expect(out).toMatchObject({ ok: false, handled: "unverifiable" });
  });

  it("accepts simulator deliveries without verification and marks them unverified", async () => {
    const out = await simulated(db, delivery("CHECKOUT.ORDER.APPROVED", { id: "ORDER-X" }, "WH-SIM"));
    expect(out).toMatchObject({ ok: true, unverified: true });
    const [row] = await eventsOf(db, "paypal.CHECKOUT.ORDER.APPROVED");
    expect(row!.payload).toMatchObject({ event_id: "WH-SIM", unverified: true });
  });

  it("acknowledges a repeated delivery of the same event once", async () => {
    const body = delivery("CHECKOUT.ORDER.APPROVED", { id: "ORDER-X" }, "WH-DUP");
    await simulated(db, body);
    const again = await simulated(db, body);
    expect(again).toMatchObject({ ok: true, handled: "duplicate" });
    expect(await eventsOf(db, "paypal.CHECKOUT.ORDER.APPROVED")).toHaveLength(1);
  });

  it("answers a body that is not JSON without throwing", async () => {
    expect(await simulated(db, "{not json")).toMatchObject({ ok: false, handled: "invalid_json" });
  });

  it("logs and acknowledges event types it does not act on", async () => {
    const out = await simulated(db, delivery("BILLING.SUBSCRIPTION.CREATED", { id: "I-1" }));
    expect(out).toMatchObject({ ok: true, handled: "ignored" });
    expect(await eventsOf(db, "paypal.BILLING.SUBSCRIPTION.CREATED")).toHaveLength(1);
  });
});

describe("handlePayPalWebhook: payments", () => {
  it("marks an order captured when the capture completes outside Counter", async () => {
    const { order } = await bookOrder(db);
    const out = await simulated(
      db,
      delivery("PAYMENT.CAPTURE.COMPLETED", {
        id: "CAPX",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "73.99" },
        supplementary_data: { related_ids: { order_id: order.paypalOrderId, authorization_id: order.authorizationId } },
      }),
    );
    expect(out.handled).toBe("order.captured");
    expect(await orderRow(db, order.id)).toMatchObject({ status: "captured", captureId: "CAPX" });
    const [row] = await eventsOf(db, "paypal.PAYMENT.CAPTURE.COMPLETED");
    expect(row).toMatchObject({ shopId: "juniper-clay", ref: order.id });
  });

  it("marks an order refunded when its capture is refunded in PayPal", async () => {
    const order = await capturedOrder();
    const out = await simulated(
      db,
      delivery("PAYMENT.CAPTURE.REFUNDED", {
        id: "REF9",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "73.99" },
        links: [
          { rel: "self", href: "https://api.sandbox.paypal.com/v2/payments/refunds/REF9" },
          { rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP1" },
        ],
      }),
    );
    expect(out.handled).toBe("order.refunded");
    expect((await orderRow(db, order.id))!.status).toBe("refunded");
  });

  it("closes an order and restocks it when PayPal voids the authorization (expiry)", async () => {
    const before = await stockOf(db, "juniper-clay", SAGE_12.variantId);
    const sink = new StockKeepingOrderSink(db, new DbOrderSink(db, { publicBaseUrl: "https://counter.test" }));
    const { order } = await bookOrder(db, { sink });
    const out = await simulated(db, delivery("PAYMENT.AUTHORIZATION.VOIDED", { id: order.authorizationId, status: "VOIDED" }));

    expect(out.handled).toBe("order.voided");
    expect((await orderRow(db, order.id))!.status).toBe("voided");
    expect(await stockOf(db, "juniper-clay", SAGE_12.variantId)).toBe(before);
    const [voided] = await eventsOf(db, "order.voided", order.id);
    expect(voided!.payload).toMatchObject({ by: "paypal" });
  });

  it("records a new authorization against its order without changing it", async () => {
    const { order } = await bookOrder(db);
    const out = await simulated(
      db,
      delivery("PAYMENT.AUTHORIZATION.CREATED", {
        id: order.authorizationId,
        status: "CREATED",
        supplementary_data: { related_ids: { order_id: order.paypalOrderId } },
      }),
    );
    expect(out.handled).toBe("order.authorized");
    expect((await orderRow(db, order.id))!.status).toBe("authorized");
    expect((await eventsOf(db, "paypal.PAYMENT.AUTHORIZATION.CREATED"))[0]!.ref).toBe(order.id);
  });

  it("logs a denied capture against the order", async () => {
    const order = await capturedOrder();
    const out = await simulated(db, delivery("PAYMENT.CAPTURE.DENIED", { id: "CAP1", status: "DECLINED" }));
    expect(out.handled).toBe("capture.denied");
    expect((await eventsOf(db, "paypal.PAYMENT.CAPTURE.DENIED"))[0]!.ref).toBe(order.id);
  });
});

describe("handlePayPalWebhook: disputes", () => {
  const dispute = (over: object = {}) => ({
    dispute_id: "PP-D-21",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "OPEN",
    dispute_amount: { currency_code: "USD", value: "73.99" },
    dispute_life_cycle_stage: "INQUIRY",
    disputed_transactions: [{ seller_transaction_id: "CAP1", seller: { merchant_id: MERCHANT } }],
    ...over,
  });

  it("records a new dispute against the order whose capture it names", async () => {
    const order = await capturedOrder();
    const out = await simulated(db, delivery("CUSTOMER.DISPUTE.CREATED", dispute()));

    expect(out.handled).toBe("dispute.recorded");
    const [row] = await db.select().from(disputes).where(eq(disputes.id, "PP-D-21"));
    expect(row).toMatchObject({ shopId: "juniper-clay", orderId: order.id, status: "OPEN", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" });
    expect((await orderRow(db, order.id))!.status).toBe("disputed");
    expect((await eventsOf(db, "paypal.CUSTOMER.DISPUTE.CREATED"))[0]!.ref).toBe("PP-D-21");
  });

  it("updates the dispute's status as it moves", async () => {
    await capturedOrder();
    await simulated(db, delivery("CUSTOMER.DISPUTE.CREATED", dispute()));
    await simulated(db, delivery("CUSTOMER.DISPUTE.UPDATED", dispute({ status: "WAITING_FOR_SELLER_RESPONSE" })));
    const [row] = await db.select().from(disputes).where(eq(disputes.id, "PP-D-21"));
    expect(row!.status).toBe("WAITING_FOR_SELLER_RESPONSE");
  });

  it("puts the order back to captured when the dispute resolves in the seller's favour", async () => {
    const order = await capturedOrder();
    await simulated(db, delivery("CUSTOMER.DISPUTE.CREATED", dispute()));
    await simulated(
      db,
      delivery("CUSTOMER.DISPUTE.RESOLVED", dispute({ status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" } })),
    );
    const [row] = await db.select().from(disputes).where(eq(disputes.id, "PP-D-21"));
    expect(row).toMatchObject({ status: "RESOLVED" });
    expect((await orderRow(db, order.id))!.status).toBe("captured");
  });

  it("marks the order refunded when the dispute resolves in the buyer's favour", async () => {
    const order = await capturedOrder();
    await simulated(db, delivery("CUSTOMER.DISPUTE.CREATED", dispute()));
    await simulated(
      db,
      delivery("CUSTOMER.DISPUTE.RESOLVED", dispute({ status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR" } })),
    );
    expect((await orderRow(db, order.id))!.status).toBe("refunded");
  });

  it("matches a dispute by the seller's merchant id when the capture is unknown", async () => {
    await onboard(db, "juniper-clay");
    const out = await simulated(
      db,
      delivery("CUSTOMER.DISPUTE.CREATED", dispute({ disputed_transactions: [{ seller_transaction_id: "CAP-OTHER", seller: { merchant_id: MERCHANT } }] })),
    );
    expect(out.handled).toBe("dispute.recorded");
    const [row] = await db.select().from(disputes).where(eq(disputes.id, "PP-D-21"));
    expect(row).toMatchObject({ shopId: "juniper-clay", orderId: null });
  });

  it("logs a dispute that matches no shop on the platform", async () => {
    const out = await simulated(db, delivery("CUSTOMER.DISPUTE.CREATED", dispute({ disputed_transactions: [{ seller_transaction_id: "NOPE" }] })));
    expect(out).toMatchObject({ ok: true, handled: "dispute.unmatched" });
    expect(await db.select().from(disputes)).toHaveLength(0);
  });
});

describe("handlePayPalWebhook: merchants", () => {
  it("links the onboarded merchant to the shop named by the tracking id", async () => {
    const out = await simulated(
      db,
      delivery("MERCHANT.ONBOARDING.COMPLETED", { merchant_id: MERCHANT, tracking_id: "counter-juniper-clay", partner_client_id: "PLATFORM-CLIENT" }),
    );
    expect(out.handled).toBe("merchant.onboarded");
    expect(await getShop(db, "juniper-clay")).toMatchObject({ paypalMerchantId: MERCHANT, onboardingStatus: "pending" });
  });

  it("does not downgrade a shop that is already active", async () => {
    await onboard(db, "juniper-clay");
    await simulated(db, delivery("MERCHANT.ONBOARDING.COMPLETED", { merchant_id: MERCHANT, tracking_id: "counter-juniper-clay" }));
    expect((await getShop(db, "juniper-clay"))!.onboardingStatus).toBe("active");
  });

  it("marks the shop revoked when the merchant withdraws consent", async () => {
    await onboard(db, "juniper-clay");
    const out = await simulated(db, delivery("MERCHANT.PARTNER-CONSENT.REVOKED", { merchant_id: MERCHANT, tracking_id: "counter-juniper-clay" }));
    expect(out.handled).toBe("merchant.revoked");
    expect((await getShop(db, "juniper-clay"))!.onboardingStatus).toBe("revoked");
  });
});
