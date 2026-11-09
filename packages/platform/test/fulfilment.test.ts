import { DbOrderSink, type Db } from "@counter/db";
import { beforeEach, describe, expect, it } from "vitest";
import { Fulfilment, PlatformError, StockKeepingOrderSink } from "../src/index";
import {
  SAGE_12,
  bookOrder,
  completedCart,
  dbShopAccounts,
  eventsOf,
  fakePayPal,
  onboard,
  orderRow,
  shopDb,
  stockOf,
  type Reply,
} from "./support";

const CAPTURED = { status: 201, json: { id: "CAP1", status: "COMPLETED", final_capture: true, links: [] } };
const TRACKED = { status: 201, json: { id: "ORDER1", status: "COMPLETED", links: [] } };

function paypalFor(order: { authorizationId: string | null; paypalOrderId: string | null }, extra: Record<string, Reply | Reply[]> = {}) {
  return fakePayPal({
    [`POST /v2/payments/authorizations/${order.authorizationId}/capture`]: CAPTURED,
    [`POST /v2/checkout/orders/${order.paypalOrderId}/track`]: TRACKED,
    [`POST /v2/payments/authorizations/${order.authorizationId}/void`]: { status: 204 },
    "POST /v2/payments/captures/CAP1/refund": { status: 201, json: { id: "REF1", status: "COMPLETED", links: [] } },
    ...extra,
  });
}

function stockSink(db: Db) {
  return new StockKeepingOrderSink(db, new DbOrderSink(db, { publicBaseUrl: "https://counter.test" }));
}

let db: Db;
beforeEach(async () => {
  db = await shopDb();
});

describe("Fulfilment.ship", () => {
  it("captures the authorization in full, adds tracking and marks the order captured", async () => {
    const { order } = await bookOrder(db);
    const pp = paypalFor(order);
    const out = await new Fulfilment(db, pp.client, dbShopAccounts(db)).ship(order.id, {
      carrier: "USPS",
      trackingNumber: "9400111899223197428490",
    });

    expect(out.captureId).toBe("CAP1");
    const [capture, track] = pp.calls();
    expect(capture!.path).toBe(`/v2/payments/authorizations/${order.authorizationId}/capture`);
    expect(capture!.json()).toEqual({ final_capture: true });
    expect(capture!.headers.get("paypal-request-id")).toBe(`${order.id}-capture`);
    expect(track!.path).toBe(`/v2/checkout/orders/${order.paypalOrderId}/track`);
    expect(track!.json()).toMatchObject({ capture_id: "CAP1", tracking_number: "9400111899223197428490", carrier: "USPS" });
    expect(track!.json().items).toEqual([{ name: SAGE_12.name, quantity: "2", sku: SAGE_12.variantId, url: expect.any(String) }]);

    const row = await orderRow(db, order.id);
    expect(row).toMatchObject({ status: "captured", captureId: "CAP1", platformFeeCents: 0 });
    expect(row!.tracking).toMatchObject({ carrier: "USPS", trackingNumber: "9400111899223197428490" });
    expect(row!.tracking!.shippedAt).toEqual(expect.any(String));
    expect(await eventsOf(db, "order.captured", order.id)).toHaveLength(1);
    expect(await eventsOf(db, "order.shipped", order.id)).toHaveLength(1);
  });

  it("takes the platform fee only when the shop is onboarded with its own merchant id", async () => {
    await onboard(db, "juniper-clay");
    const { order } = await bookOrder(db);
    const pp = paypalFor(order);
    await new Fulfilment(db, pp.client, dbShopAccounts(db)).ship(order.id, { carrier: "UPS", trackingNumber: "1Z999" });

    const capture = pp.calls()[0]!;
    // 2% of 73.99
    expect(capture.json()).toEqual({
      final_capture: true,
      payment_instruction: { platform_fees: [{ amount: { currency_code: "USD", value: "1.48" } }] },
    });
    expect(capture.headers.get("paypal-auth-assertion")).toContain(".");
    expect((await orderRow(db, order.id))!.platformFeeCents).toBe(148);
  });

  it("honours a custom platform fee rate", async () => {
    await onboard(db, "juniper-clay");
    const { order } = await bookOrder(db);
    const pp = paypalFor(order);
    await new Fulfilment(db, pp.client, dbShopAccounts(db), { platformFeeBps: 500 }).ship(order.id, { carrier: "UPS", trackingNumber: "1Z1" });
    expect(pp.calls()[0]!.json().payment_instruction.platform_fees[0].amount.value).toBe("3.70");
  });

  it("is idempotent: shipping again returns the existing capture without calling PayPal", async () => {
    const { order } = await bookOrder(db);
    const pp = paypalFor(order);
    const f = new Fulfilment(db, pp.client, dbShopAccounts(db));
    const first = await f.ship(order.id, { carrier: "USPS", trackingNumber: "T1" });
    const again = await f.ship(order.id, { carrier: "USPS", trackingNumber: "T1" });

    expect(again.captureId).toBe(first.captureId);
    expect(again.alreadyShipped).toBe(true);
    expect(pp.callsTo("POST", "/v2/payments/authorizations")).toHaveLength(1);
    expect(pp.callsTo("POST", "/v2/checkout/orders")).toHaveLength(1);
    expect(await eventsOf(db, "order.captured", order.id)).toHaveLength(1);
  });

  it("keeps the capture when PayPal rejects the tracking, and resends only the tracking on retry", async () => {
    const { order } = await bookOrder(db);
    const pp = paypalFor(order, {
      [`POST /v2/checkout/orders/${order.paypalOrderId}/track`]: [{ status: 500, json: { name: "INTERNAL_SERVER_ERROR" } }, TRACKED],
    });
    const f = new Fulfilment(db, pp.client, dbShopAccounts(db));
    await expect(f.ship(order.id, { carrier: "USPS", trackingNumber: "T1" })).rejects.toThrow();
    expect(await orderRow(db, order.id)).toMatchObject({ status: "captured", captureId: "CAP1", tracking: null });

    const out = await f.ship(order.id, { carrier: "USPS", trackingNumber: "T1" });
    expect(out.captureId).toBe("CAP1");
    expect(pp.callsTo("POST", "/v2/payments/authorizations")).toHaveLength(1);
    expect((await orderRow(db, order.id))!.tracking).toMatchObject({ trackingNumber: "T1" });
  });

  it("refuses to ship a voided order", async () => {
    const { order } = await bookOrder(db);
    const pp = paypalFor(order);
    const f = new Fulfilment(db, pp.client, dbShopAccounts(db));
    await f.cancel(order.id, "out of clay");
    const err = await f.ship(order.id, { carrier: "USPS", trackingNumber: "T1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformError);
    expect((err as PlatformError).code).toBe("conflict");
  });

  it("answers not_found for an unknown order", async () => {
    const pp = fakePayPal();
    const err = await new Fulfilment(db, pp.client, dbShopAccounts(db)).ship("JC-1", { carrier: "USPS", trackingNumber: "T" }).catch((e: unknown) => e);
    expect((err as PlatformError).code).toBe("not_found");
  });

  it("rejects a shipment without a carrier or tracking number", async () => {
    const { order } = await bookOrder(db);
    const err = await new Fulfilment(db, fakePayPal().client, dbShopAccounts(db)).ship(order.id, { carrier: " ", trackingNumber: "T" }).catch((e: unknown) => e);
    expect((err as PlatformError).code).toBe("invalid_request");
  });
});

describe("Fulfilment.cancel", () => {
  it("voids the authorization, marks the order voided and puts reserved stock back", async () => {
    const before = await stockOf(db, "juniper-clay", SAGE_12.variantId);
    const { order } = await bookOrder(db, { sink: stockSink(db) });
    expect(await stockOf(db, "juniper-clay", SAGE_12.variantId)).toBe(before - 2);

    const pp = paypalFor(order);
    const out = await new Fulfilment(db, pp.client, dbShopAccounts(db)).cancel(order.id, "glaze cracked in the kiln");

    expect(out.status).toBe("voided");
    const voidCall = pp.calls()[0]!;
    expect(voidCall.path).toBe(`/v2/payments/authorizations/${order.authorizationId}/void`);
    expect(voidCall.headers.get("paypal-request-id")).toBe(`${order.id}-void`);
    expect(await stockOf(db, "juniper-clay", SAGE_12.variantId)).toBe(before);
    const [voided] = await eventsOf(db, "order.voided", order.id);
    expect(voided!.payload).toMatchObject({ reason: "glaze cracked in the kiln" });
  });

  it("is idempotent and restores stock only once", async () => {
    const before = await stockOf(db, "juniper-clay", SAGE_12.variantId);
    const { order } = await bookOrder(db, { sink: stockSink(db) });
    const pp = paypalFor(order);
    const f = new Fulfilment(db, pp.client, dbShopAccounts(db));
    await f.cancel(order.id, "a");
    await f.cancel(order.id, "a");
    expect(pp.calls()).toHaveLength(1);
    expect(await stockOf(db, "juniper-clay", SAGE_12.variantId)).toBe(before);
    expect(await eventsOf(db, "order.voided", order.id)).toHaveLength(1);
  });

  it("leaves stock alone for orders that never reserved any", async () => {
    const before = await stockOf(db, "juniper-clay", SAGE_12.variantId);
    const { order } = await bookOrder(db);
    await new Fulfilment(db, paypalFor(order).client, dbShopAccounts(db)).cancel(order.id, "x");
    expect(await stockOf(db, "juniper-clay", SAGE_12.variantId)).toBe(before);
  });

  it("refuses to cancel a captured order (refund it instead)", async () => {
    const { order } = await bookOrder(db);
    const f = new Fulfilment(db, paypalFor(order).client, dbShopAccounts(db));
    await f.ship(order.id, { carrier: "USPS", trackingNumber: "T1" });
    const err = await f.cancel(order.id, "x").catch((e: unknown) => e);
    expect((err as PlatformError).code).toBe("conflict");
  });

  it("treats an authorization PayPal already voided as voided", async () => {
    const { order } = await bookOrder(db);
    const pp = paypalFor(order, {
      [`POST /v2/payments/authorizations/${order.authorizationId}/void`]: {
        status: 422,
        json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "PREVIOUSLY_VOIDED" }] },
      },
    });
    const out = await new Fulfilment(db, pp.client, dbShopAccounts(db)).cancel(order.id, "expired");
    expect(out.status).toBe("voided");
  });
});

describe("Fulfilment.refund", () => {
  it("refunds the capture (partially here) and marks the order refunded", async () => {
    await onboard(db, "juniper-clay");
    const { order } = await bookOrder(db);
    const pp = paypalFor(order);
    const f = new Fulfilment(db, pp.client, dbShopAccounts(db));
    await f.ship(order.id, { carrier: "USPS", trackingNumber: "T1" });
    const out = await f.refund(order.id, 1000);

    expect(out).toMatchObject({ refundId: "REF1", amountCents: 1000 });
    const call = pp.callsTo("POST", "/v2/payments/captures/CAP1/refund")[0]!;
    expect(call.json()).toEqual({ amount: { currency_code: "USD", value: "10.00" } });
    expect(call.headers.get("paypal-auth-assertion")).toBeTruthy();
    expect((await orderRow(db, order.id))!.status).toBe("refunded");
    const [ev] = await eventsOf(db, "order.refunded", order.id);
    expect(ev!.payload).toMatchObject({ refund_id: "REF1", amount_cents: 1000 });
  });

  it("refunds in full when no amount is given, and only once", async () => {
    const { order } = await bookOrder(db);
    const pp = paypalFor(order);
    const f = new Fulfilment(db, pp.client, dbShopAccounts(db));
    await f.ship(order.id, { carrier: "USPS", trackingNumber: "T1" });
    const first = await f.refund(order.id);
    const again = await f.refund(order.id);
    expect(pp.callsTo("POST", "/v2/payments/captures/CAP1/refund")).toHaveLength(1);
    expect(pp.callsTo("POST", "/v2/payments/captures/CAP1/refund")[0]!.json()).toEqual({});
    expect(first.amountCents).toBe(order.totalCents);
    expect(again.refundId).toBe("REF1");
  });

  it("refuses to refund an order that was never captured", async () => {
    const { order } = await bookOrder(db);
    const err = await new Fulfilment(db, paypalFor(order).client, dbShopAccounts(db)).refund(order.id).catch((e: unknown) => e);
    expect((err as PlatformError).code).toBe("conflict");
  });

  it("rejects an amount above the order total", async () => {
    const { order } = await bookOrder(db);
    const f = new Fulfilment(db, paypalFor(order).client, dbShopAccounts(db));
    await f.ship(order.id, { carrier: "USPS", trackingNumber: "T1" });
    const err = await f.refund(order.id, order.totalCents + 1).catch((e: unknown) => e);
    expect((err as PlatformError).code).toBe("invalid_request");
  });
});

describe("StockKeepingOrderSink", () => {
  it("books the order through the wrapped sink and takes stock exactly once per order", async () => {
    const before = await stockOf(db, "juniper-clay", SAGE_12.variantId);
    const sink = stockSink(db);
    const cart = completedCart();
    const { order } = await bookOrder(db, { cart, sink });
    const again = await sink.onCompleted(cart, { authorizationId: order.authorizationId!, payerId: "PAYER9" });

    expect(again.merchantOrderNumber).toBe(order.id);
    expect(await stockOf(db, "juniper-clay", SAGE_12.variantId)).toBe(before - 2);
    const [reserved] = await eventsOf(db, "order.stock_reserved", order.id);
    expect(reserved!.payload).toMatchObject({ lines: [{ variant_id: SAGE_12.variantId, quantity: 2 }] });
    expect(await eventsOf(db, "order.stock_reserved", order.id)).toHaveLength(1);
  });

  it("adds up repeated lines for the same variant", async () => {
    const before = await stockOf(db, "juniper-clay", SAGE_12.variantId);
    const cart = completedCart({ lines: [SAGE_12, { ...SAGE_12, quantity: 1 }] });
    await bookOrder(db, { cart, sink: stockSink(db) });
    expect(await stockOf(db, "juniper-clay", SAGE_12.variantId)).toBe(before - 3);
  });
});

