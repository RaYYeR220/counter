import "server-only";
import { logEvent, orders, updateOrder, variants, type Shop } from "@counter/db";
import { refreshMarket } from "@counter/importer";
import { Fulfilment, markVoided, PlatformError } from "@counter/platform";
import { PayPalApiError } from "@counter/paypal";
import { and, eq } from "drizzle-orm";
import { channel3 } from "@/app/api/studio/_lib/studio";
import { db, paypal, shopAccounts } from "@/lib/server/runtime";
import type { ConsoleAction, ConsoleActionResult } from "../types";
import { isSimulated, loadCatalog, loadOrder, minFloorCents, variantView } from "./data";

/** A refusal the merchant can act on: shown as is. */
export class ActionRefused extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

async function orderRow(shopId: string, orderId: string) {
  const [row] = await db()
    .select()
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.id, orderId)))
    .limit(1);
  if (!row) throw new ActionRefused(`There is no order ${orderId} in this shop`, 404);
  return row;
}

function fulfilment(): Fulfilment {
  return new Fulfilment(db(), paypal(), shopAccounts);
}

// Seeded demo orders and stubbed-payment bench orders hold no real PayPal
// authorization, so their state changes here without a PayPal call, and the
// events say so.

async function simulatedShip(shopId: string, orderId: string, carrier: string, trackingNumber: string) {
  const row = await orderRow(shopId, orderId);
  if (row.tracking) return;
  if (row.status !== "authorized" && row.status !== "captured") {
    throw new ActionRefused(`Order ${orderId} is ${row.status} and cannot ship`);
  }
  const demo = Boolean(row.paypalOrderId?.startsWith("DEMO-"));
  const captureId = row.captureId ?? `SIM-CAPTURE-${row.id}`;
  if (row.status === "authorized") {
    await updateOrder(db(), row.id, { status: "captured", captureId, platformFeeCents: 0 });
    await logEvent(db(), shopId, "order.captured", row.id, { capture_id: captureId, amount_cents: row.totalCents, simulated: true, demo });
  }
  await updateOrder(db(), row.id, { tracking: { carrier, trackingNumber, shippedAt: new Date().toISOString() } });
  await logEvent(db(), shopId, "order.shipped", row.id, { carrier, tracking_number: trackingNumber, capture_id: captureId, simulated: true, demo });
}

async function simulatedRefund(shopId: string, orderId: string, amountCents?: number) {
  const row = await orderRow(shopId, orderId);
  if (row.status === "refunded") return;
  if (!(row.status === "captured" || row.status === "disputed")) {
    throw new ActionRefused(`Order ${orderId} is ${row.status}; only shipped orders can be refunded`);
  }
  const amount = amountCents ?? row.totalCents;
  if (amount <= 0 || amount > row.totalCents) throw new ActionRefused(`Refund must be between $0.01 and the order total`, 400);
  const demo = Boolean(row.paypalOrderId?.startsWith("DEMO-"));
  await updateOrder(db(), row.id, { status: "refunded" });
  await logEvent(db(), shopId, "order.refunded", row.id, { amount_cents: amount, refund_id: `SIM-REFUND-${row.id}`, simulated: true, demo });
}

export async function runAction(shop: Shop, action: ConsoleAction): Promise<ConsoleActionResult> {
  const shopId = shop.slug;
  switch (action.kind) {
    case "ship": {
      const row = await orderRow(shopId, action.orderId);
      const simulated = isSimulated(row.paypalOrderId, row.authorizationId);
      if (simulated) await simulatedShip(shopId, row.id, action.carrier, action.trackingNumber);
      else await fulfilment().ship(row.id, { carrier: action.carrier, trackingNumber: action.trackingNumber });
      const order = await loadOrder(shopId, row.id);
      return { ok: true, simulated, order: order ?? undefined, message: `Shipped ${row.id} with ${action.carrier} ${action.trackingNumber}; payment captured.` };
    }
    case "cancel": {
      const row = await orderRow(shopId, action.orderId);
      const simulated = isSimulated(row.paypalOrderId, row.authorizationId);
      const reason = action.reason?.trim() || "cancelled by the shop";
      if (simulated) {
        if (row.status !== "authorized" && row.status !== "voided") {
          throw new ActionRefused(`Order ${row.id} is ${row.status}; only orders that have not shipped can be cancelled`);
        }
        await markVoided(db(), row.id, reason, "merchant");
      } else {
        await fulfilment().cancel(row.id, reason);
      }
      const order = await loadOrder(shopId, row.id);
      return { ok: true, simulated, order: order ?? undefined, message: `Cancelled ${row.id}; the buyer's hold is released and stock is back.` };
    }
    case "refund": {
      const row = await orderRow(shopId, action.orderId);
      const simulated = isSimulated(row.paypalOrderId, row.authorizationId);
      if (simulated) await simulatedRefund(shopId, row.id, action.amountCents);
      else await fulfilment().refund(row.id, action.amountCents);
      const order = await loadOrder(shopId, row.id);
      return { ok: true, simulated, order: order ?? undefined, message: `Refunded ${row.id}.` };
    }
    case "set_floor": {
      const [v] = await db()
        .select()
        .from(variants)
        .where(and(eq(variants.shopId, shopId), eq(variants.variantId, action.variantId)))
        .limit(1);
      if (!v) throw new ActionRefused(`There is no variant ${action.variantId} in this shop`, 404);
      const min = minFloorCents(v.costCents);
      if (action.floorCents < min) {
        throw new ActionRefused(`The floor for ${v.name} can't go below $${(min / 100).toFixed(2)} (cost × 1.25)`, 422);
      }
      if (action.floorCents > v.priceCents) {
        throw new ActionRefused(`The floor for ${v.name} can't be above its price of $${(v.priceCents / 100).toFixed(2)}`, 422);
      }
      const [saved] = await db()
        .update(variants)
        .set({ floorCents: action.floorCents })
        .where(eq(variants.id, v.id))
        .returning();
      await logEvent(db(), shopId, "catalog.floor_changed", v.variantId, {
        variant_id: v.variantId,
        from_cents: v.floorCents,
        to_cents: action.floorCents,
        by: "console",
      });
      return {
        ok: true,
        variant: variantView(saved!),
        message: `Floor for ${v.name} is now $${(action.floorCents / 100).toFixed(2)} (was $${(v.floorCents / 100).toFixed(2)}).`,
      };
    }
    case "market_check": {
      const out = await refreshMarket(db(), shopId, action.variantIds, { channel3: channel3() });
      const wanted = new Set(action.variantIds);
      const list = (await loadCatalog(shopId)).filter((v) => wanted.has(v.variantId));
      const parts = [`Checked ${out.checked} variant${out.checked === 1 ? "" : "s"} against other sellers`];
      if (out.updated) parts.push(`${out.updated} updated`);
      if (out.noComparables.length) parts.push(`no comparable listings for ${out.noComparables.length}`);
      if (out.missing.length) parts.push(`not found: ${out.missing.join(", ")}`);
      return { ok: true, variants: list, message: `${parts.join("; ")}.` };
    }
  }
}

/** Turns a failure into a merchant-facing message and status. */
export function actionError(err: unknown): { status: number; message: string } {
  if (err instanceof ActionRefused) return { status: err.status, message: err.message };
  if (err instanceof PlatformError) return { status: err.httpStatus, message: err.message };
  if (err instanceof PayPalApiError) {
    const refused = err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403;
    return { status: refused ? 422 : 502, message: refused ? `PayPal refused: ${err.message}` : "PayPal didn't answer; try again in a minute." };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set/.test(message)) {
    return { status: 503, message: "PayPal isn't connected on this deployment, so real orders can't be shipped from here yet." };
  }
  if (/DATABASE_URL is not set/.test(message)) return { status: 503, message: "The shop's database isn't configured." };
  console.error("console.action", err);
  return { status: 502, message: "That didn't go through. PayPal or the database didn't answer; try again in a minute." };
}

