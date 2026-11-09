"use client";

import { consoleBus } from "../bus";
import { consoleApi } from "../client";

// Shipments the assistant has prepared and the merchant has not yet confirmed.
// The assistant's `ship_order` tool only ever adds an entry here; shipping
// (capturing the buyer's payment) happens when the merchant presses Confirm.

export type PendingStatus = "pending" | "confirming" | "shipped" | "discarded" | "failed";

export interface PendingShipment {
  id: string;
  shop: string;
  orderId: string;
  carrier: string;
  trackingNumber: string;
  totalCents: number;
  summary: string;
  status: PendingStatus;
  message?: string;
}

let items: readonly PendingShipment[] = [];
const listeners = new Set<() => void>();

function emit(next: readonly PendingShipment[]) {
  items = next;
  for (const l of listeners) l();
}

function patch(id: string, change: Partial<PendingShipment>) {
  emit(items.map((p) => (p.id === id ? { ...p, ...change } : p)));
}

export const pendingShipments = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  snapshot: (): readonly PendingShipment[] => items,
  get: (id: string) => items.find((p) => p.id === id),

  add(p: Omit<PendingShipment, "id" | "status">): PendingShipment {
    // One open shipment per order: a newer one replaces it.
    const entry: PendingShipment = { ...p, id: `ship-${p.orderId}-${Date.now().toString(36)}`, status: "pending" };
    emit([...items.filter((x) => !(x.orderId === p.orderId && x.status === "pending")), entry]);
    return entry;
  },

  discard(id: string) {
    patch(id, { status: "discarded", message: "Discarded. Nothing was shipped." });
  },

  async confirm(id: string): Promise<void> {
    const p = items.find((x) => x.id === id);
    if (!p || p.status !== "pending") return;
    patch(id, { status: "confirming" });
    try {
      const out = await consoleApi.act(p.shop, { kind: "ship", orderId: p.orderId, carrier: p.carrier, trackingNumber: p.trackingNumber });
      if (!out.ok) {
        patch(id, { status: "failed", message: out.message });
        return;
      }
      patch(id, { status: "shipped", message: out.message });
      if (out.order) consoleBus.send({ kind: "order-changed", order: out.order, message: out.message });
    } catch (err) {
      patch(id, { status: "failed", message: err instanceof Error ? err.message : "The shipment didn't go through." });
    }
  },
};
