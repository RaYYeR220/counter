"use client";

import { ago, moneyCents } from "@/lib/console/format";
import type { ConsoleNegotiation } from "@/lib/console/types";
import s from "./detail.module.css";

const VERDICT: Record<ConsoleNegotiation["verdict"], { text: string; tone: string }> = {
  accept: { text: "Accepted", tone: "ok" },
  clamped: { text: "Countered", tone: "warn" },
  refuse: { text: "Refused", tone: "bad" },
  none: { text: "No offer", tone: "" },
};

/** A negotiation's transcript in a Studio popup, with the numbers it turned on. */
export function NegotiationDetail({ negotiation: n, closePopup }: { negotiation: ConsoleNegotiation; closePopup?: () => void }) {
  const v = VERDICT[n.verdict];
  return (
    <div className={s.detail}>
      <header className={s.head}>
        <div>
          <p className={s.kicker}>
            {ago(n.createdAt)} ago with{" "}
            <span className={s.agent}>
              <span>{n.agentLabel}</span>
            </span>
          </p>
          <h2 className={s.title}>{n.variantName}</h2>
        </div>
        <span className={s.chip} data-tone={v.tone}>
          {v.text}
        </span>
      </header>
      <dl className={s.numbers}>
        <div>
          <dt>List</dt>
          <dd>{moneyCents(n.listCents)}</dd>
        </div>
        <div>
          <dt>Asked</dt>
          <dd>{moneyCents(n.askCents)}</dd>
        </div>
        <div>
          <dt>Agreed</dt>
          <dd>{moneyCents(n.finalUnitCents)}</dd>
        </div>
        <div data-floor>
          <dt>Your floor</dt>
          <dd>{moneyCents(n.floorCents)}</dd>
        </div>
      </dl>
      <ol className={s.transcript}>
        {n.transcript.map((t, i) => (
          <li key={i} data-from={t.from}>
            <span className={s.speaker}>{t.from === "buyer" ? n.agentLabel : "Seller agent"}</span>
            <p>{t.text}</p>
          </li>
        ))}
      </ol>
      {closePopup ? (
        <div className={s.actions}>
          <button type="button" className={s.quiet} onClick={closePopup}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
