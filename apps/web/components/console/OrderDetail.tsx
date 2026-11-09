"use client";

import { useState, type FormEvent } from "react";
import { ago, moneyCents } from "@/lib/console/format";
import { eventName } from "@/lib/console/studio/data";
import type { ConsoleActionResult, ConsoleEvent, ConsoleOrder } from "@/lib/console/types";
import s from "./detail.module.css";

export type OrderAction =
  | { kind: "ship"; carrier: string; trackingNumber: string }
  | { kind: "cancel" }
  | { kind: "refund" };

export interface OrderDetailProps {
  order: ConsoleOrder;
  events: ConsoleEvent[];
  /** Open the ship form straight away. */
  shipping?: boolean;
  act: (orderId: string, action: OrderAction) => Promise<ConsoleActionResult>;
  closePopup?: () => void;
}

const CARRIERS = ["USPS", "UPS", "FedEx", "DHL"];

const STATUS: Record<ConsoleOrder["fulfilment"], { text: string; tone: string }> = {
  to_ship: { text: "To ship", tone: "accent" },
  shipped: { text: "Shipped", tone: "ok" },
  cancelled: { text: "Cancelled", tone: "warn" },
  refunded: { text: "Refunded", tone: "warn" },
  disputed: { text: "Disputed", tone: "bad" },
};

/** An order in a Studio popup: what was bought, by which agent, its history, and the next action. */
export function OrderDetail({ order, events, shipping, act, closePopup }: OrderDetailProps) {
  const [form, setForm] = useState(Boolean(shipping) && order.fulfilment === "to_ship");
  const [carrier, setCarrier] = useState("USPS");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirming, setConfirming] = useState<"cancel" | "refund" | null>(null);

  const run = async (label: string, action: OrderAction) => {
    setBusy(label);
    setResult(null);
    try {
      const out = await act(order.id, action);
      setResult({ ok: out.ok, message: out.message });
      if (out.ok) {
        setForm(false);
        setConfirming(null);
      }
    } finally {
      setBusy(null);
    }
  };

  const submitShip = (e: FormEvent) => {
    e.preventDefault();
    if (!tracking.trim()) return;
    void run("ship", { kind: "ship", carrier, trackingNumber: tracking.trim() });
  };

  const status = STATUS[order.fulfilment];
  const history = events.filter((e) => e.ref === order.id).slice(-8).reverse();

  return (
    <div className={s.detail}>
      <header className={s.head}>
        <div>
          <p className={s.kicker}>
            Placed {ago(order.createdAt)} ago by{" "}
            <span className={s.agent}>
              <span>{order.agentLabel}</span>
            </span>
          </p>
          <h2 className={s.title}>{order.id}</h2>
        </div>
        <span className={s.chip} data-tone={status.tone}>
          {status.text}
        </span>
      </header>

      <table className={s.lines}>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.variantId || l.name}>
              <td className={s.qty}>{l.quantity} ×</td>
              <td>{l.name}</td>
              <td className={s.money}>{moneyCents(l.unitCents * l.quantity)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <td>Total with shipping and tax</td>
            <td className={s.money}>{moneyCents(order.totalCents)}</td>
          </tr>
        </tfoot>
      </table>

      <dl className={s.facts}>
        <dt>Ship to</dt>
        <dd>{order.shipTo ?? "On the PayPal order"}</dd>
        <dt>Payment</dt>
        <dd>
          {order.status === "authorized"
            ? "Authorized; captured when you ship"
            : order.status === "captured"
              ? "Captured"
              : order.status === "voided"
                ? "Hold released"
                : order.status}
        </dd>
        {order.trackingNumber ? (
          <>
            <dt>Tracking</dt>
            <dd>
              {order.carrier} {order.trackingNumber}
            </dd>
          </>
        ) : null}
        {order.disputeStatus ? (
          <>
            <dt>Dispute</dt>
            <dd>
              {order.disputeStatus}
              {order.disputeReason ? `: ${order.disputeReason}` : ""}
            </dd>
          </>
        ) : null}
      </dl>

      {order.simulated ? (
        <p className={s.notice}>Demo order: actions change it here without calling PayPal.</p>
      ) : null}

      {form ? (
        <form className={s.shipForm} onSubmit={submitShip}>
          <label className={s.field}>
            <span>Carrier</span>
            <select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {CARRIERS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            <span>Tracking number</span>
            <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="9400 1000 0000 0000 0000 00" autoFocus required maxLength={100} />
          </label>
          <p className={s.hint}>Shipping captures {moneyCents(order.totalCents)} from the buyer&rsquo;s PayPal and sends the tracking number to PayPal.</p>
          <div className={s.actions}>
            <button type="submit" className={s.primary} disabled={busy != null || !tracking.trim()}>
              {busy === "ship" ? "Shipping…" : "Ship and capture payment"}
            </button>
            <button type="button" className={s.secondary} onClick={() => setForm(false)} disabled={busy != null}>
              Back
            </button>
          </div>
        </form>
      ) : confirming ? (
        <div className={s.shipForm}>
          <p className={s.hint}>
            {confirming === "cancel"
              ? "Cancelling releases the buyer's payment hold and puts the items back in stock."
              : `Refunding returns ${moneyCents(order.totalCents)} to the buyer.`}
          </p>
          <div className={s.actions}>
            <button
              type="button"
              className={s.danger}
              disabled={busy != null}
              onClick={() => void run(confirming, { kind: confirming })}
            >
              {busy ? "Working…" : confirming === "cancel" ? "Cancel order" : "Refund order"}
            </button>
            <button type="button" className={s.secondary} onClick={() => setConfirming(null)} disabled={busy != null}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className={s.actions}>
          {order.fulfilment === "to_ship" ? (
            <>
              <button type="button" className={s.primary} onClick={() => setForm(true)}>
                Ship…
              </button>
              <button type="button" className={s.secondary} onClick={() => setConfirming("cancel")}>
                Cancel order
              </button>
            </>
          ) : null}
          {order.fulfilment === "shipped" || order.fulfilment === "disputed" ? (
            <button type="button" className={s.secondary} onClick={() => setConfirming("refund")}>
              Refund…
            </button>
          ) : null}
          {closePopup ? (
            <button type="button" className={s.quiet} onClick={closePopup}>
              Close
            </button>
          ) : null}
        </div>
      )}

      {result ? (
        <p className={s.result} data-ok={result.ok} role="status">
          {result.message}
        </p>
      ) : null}

      {history.length ? (
        <section className={s.history} aria-label="History">
          <h3>History</h3>
          <ol>
            {history.map((e) => (
              <li key={e.id}>
                <span>{eventName(e.type)}</span>
                <time dateTime={e.at}>{ago(e.at)} ago</time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
