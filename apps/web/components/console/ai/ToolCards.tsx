"use client";

import type { AgAiToolDetailParams, AgAiToolLabelParams } from "ag-studio";
import type { AgAiToolDisplay } from "ag-studio-react";
import { useSyncExternalStore } from "react";
import { pendingShipments, type PendingShipment } from "@/lib/console/ai/pending";
import { consoleBus } from "@/lib/console/bus";
import { moneyCents } from "@/lib/console/format";
import type { ConsoleNegotiation, ConsoleVariant } from "@/lib/console/types";
import s from "./tool-cards.module.css";

// How the merchant-ops agent's tool calls read in Studio's chat panel: a line
// per call (`label`) and a card that opens under it (`detail`).

type OrderLite = { id: string; summary: string; totalCents: number; agent: string; ageHours: number; shipTo: string | null };

function data<T>(p: AgAiToolDetailParams): T | undefined {
  return p.result && p.result.success ? (p.result.data as T) : undefined;
}

function age(hours: number): string {
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

function OrdersCard(p: AgAiToolDetailParams) {
  const d = data<{ orders: OrderLite[]; total: number }>(p);
  if (!d) return null;
  if (d.orders.length === 0) return <p className={s.note}>Nothing is waiting to ship.</p>;
  return (
    <ul className={s.list}>
      {d.orders.map((o) => (
        <li key={o.id} className={s.row}>
          <button type="button" className={s.link} onClick={() => consoleBus.send({ kind: "open-order", orderId: o.id })}>
            {o.id}
          </button>
          <span className={s.grow}>{o.summary}</span>
          <span className={s.num}>{moneyCents(o.totalCents)}</span>
          <span className={s.muted}>{age(o.ageHours)}</span>
        </li>
      ))}
    </ul>
  );
}

const usePending = () => useSyncExternalStore(pendingShipments.subscribe, pendingShipments.snapshot, pendingShipments.snapshot);

export function ShipmentConfirm({ shipment }: { shipment: PendingShipment }) {
  const p = shipment;
  return (
    <div className={s.confirm} data-status={p.status}>
      <div className={s.confirmHead}>
        <strong>Ship {p.orderId}</strong>
        <span className={s.num}>{moneyCents(p.totalCents)}</span>
      </div>
      <p className={s.muted}>{p.summary}</p>
      <dl className={s.facts}>
        <dt>Carrier</dt>
        <dd>{p.carrier}</dd>
        <dt>Tracking</dt>
        <dd>{p.trackingNumber}</dd>
      </dl>
      {p.status === "pending" || p.status === "confirming" ? (
        <>
          <p className={s.note}>Confirming captures the buyer&rsquo;s payment and sends the tracking number to PayPal.</p>
          <div className={s.actions}>
            <button type="button" className={s.primary} disabled={p.status === "confirming"} onClick={() => void pendingShipments.confirm(p.id)}>
              {p.status === "confirming" ? "Shipping…" : "Confirm shipment"}
            </button>
            <button type="button" className={s.secondary} disabled={p.status === "confirming"} onClick={() => pendingShipments.discard(p.id)}>
              Discard
            </button>
          </div>
        </>
      ) : (
        <p className={s.outcome} data-status={p.status}>
          {p.message ?? (p.status === "shipped" ? "Shipped." : "")}
        </p>
      )}
    </div>
  );
}

function ShipCard(p: AgAiToolDetailParams) {
  const d = data<{ pendingId: string }>(p);
  const all = usePending();
  const shipment = d ? all.find((x) => x.id === d.pendingId) : undefined;
  if (!shipment) return d ? <p className={s.note}>This shipment is no longer open.</p> : null;
  return <ShipmentConfirm shipment={shipment} />;
}

function NegotiationCard(p: AgAiToolDetailParams) {
  const n = data<{ negotiation: ConsoleNegotiation }>(p)?.negotiation;
  if (!n) return null;
  const marks = [n.listCents, n.askCents, n.answerCents, n.finalUnitCents, n.floorCents].filter((v): v is number => v != null);
  const lo = Math.min(...marks) * 0.9;
  const hi = n.listCents * 1.04;
  const x = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  return (
    <div className={s.negotiation}>
      <div className={s.confirmHead}>
        <strong>{n.variantName}</strong>
        <span className={s.muted}>{n.agentLabel}</span>
      </div>
      <div className={s.ladder} role="img" aria-label={`Asked ${moneyCents(n.askCents)}, agreed ${moneyCents(n.finalUnitCents)}, floor ${moneyCents(n.floorCents)}`}>
        <span className={s.rail} />
        {n.floorCents != null ? <span className={s.zone} style={{ width: x(n.floorCents) }} /> : null}
        {n.floorCents != null ? <span className={s.floor} style={{ left: x(n.floorCents) }} /> : null}
        {n.askCents != null ? <span className={s.ask} style={{ left: x(n.askCents) }} /> : null}
        {n.finalUnitCents != null ? <span className={s.final} style={{ left: x(n.finalUnitCents) }} /> : null}
        <span className={s.list} style={{ left: x(n.listCents) }} />
      </div>
      <dl className={s.facts}>
        <dt>Asked</dt>
        <dd>{moneyCents(n.askCents)}</dd>
        <dt>Agreed</dt>
        <dd>{moneyCents(n.finalUnitCents)}</dd>
        <dt>Floor</dt>
        <dd className={s.floorText}>{moneyCents(n.floorCents)}</dd>
        <dt>List</dt>
        <dd>{moneyCents(n.listCents)}</dd>
      </dl>
      <button type="button" className={s.link} onClick={() => consoleBus.send({ kind: "open-negotiation", negotiationId: n.id })}>
        Open transcript
      </button>
    </div>
  );
}

function FloorCard(p: AgAiToolDetailParams) {
  const v = data<{ variant?: ConsoleVariant }>(p)?.variant;
  if (!v) return null;
  return (
    <dl className={s.facts}>
      <dt>Item</dt>
      <dd>{v.name}</dd>
      <dt>New floor</dt>
      <dd className={s.floorText}>{moneyCents(v.floorCents)}</dd>
      <dt>Allowed</dt>
      <dd>
        {moneyCents(v.minFloorCents)} to {moneyCents(v.priceCents)}
      </dd>
    </dl>
  );
}

function MarketCard(p: AgAiToolDetailParams) {
  const variants = data<{ variants: ConsoleVariant[] }>(p)?.variants ?? [];
  if (variants.length === 0) return null;
  return (
    <ul className={s.list}>
      {variants.map((v) => (
        <li key={v.variantId} className={s.row}>
          <span className={s.grow}>{v.name}</span>
          <span className={s.num}>{moneyCents(v.priceCents)}</span>
          <span className={s.muted}>
            {v.market ? `${moneyCents(v.market.lowCents, true)}–${moneyCents(v.market.highCents, true)}` : "no comparables"}
          </span>
        </li>
      ))}
    </ul>
  );
}

type Label = (p: AgAiToolLabelParams) => { text: string; pill?: string };

const failed = (p: AgAiToolLabelParams) => p.result != null && !p.result.success;

const label =
  (doing: string, done: (p: AgAiToolLabelParams) => string, pill?: (p: AgAiToolLabelParams) => string | undefined, failure?: string): Label =>
  (p) => {
    if (p.status === "cancelled") return { text: doing, pill: "Stopped" };
    if (!p.result) return { text: doing };
    if (failed(p)) return { text: failure ?? doing, pill: "Refused" };
    const pv = pill?.(p);
    return pv ? { text: done(p), pill: pv } : { text: done(p) };
  };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** `aiToolDisplay` for the merchant-ops tools. */
export const merchantOpsToolDisplay: Record<string, AgAiToolDisplay> = {
  list_orders_to_ship: {
    label: label(
      "Looking up orders to ship",
      () => "Looked up orders to ship",
      (p) => {
        const d = p.result?.success ? (p.result.data as { total?: number } | undefined) : undefined;
        return d?.total != null ? `${d.total} waiting` : undefined;
      },
    ),
    detail: OrdersCard,
  },
  ship_order: {
    label: label(
      "Preparing a shipment",
      (p) => `Prepared shipment of ${str(p.args.orderId)}`,
      () => "Needs your OK",
      "Couldn't prepare the shipment",
    ),
    detail: ShipCard,
  },
  explain_negotiation: {
    label: label("Reading the negotiation", () => "Read the negotiation"),
    detail: NegotiationCard,
  },
  set_floor: {
    label: label(
      "Changing a floor",
      (p) => `Changed the floor of ${str(p.args.variantId)}`,
      (p) => (typeof p.args.floor === "number" ? `$${p.args.floor.toFixed(2)}` : undefined),
      "Floor change refused",
    ),
    detail: FloorCard,
  },
  market_check: {
    label: label("Checking other sellers' prices", () => "Checked other sellers' prices", (p) =>
      Array.isArray(p.args.variantIds) ? `${p.args.variantIds.length} items` : undefined,
    ),
    detail: MarketCard,
  },
};
