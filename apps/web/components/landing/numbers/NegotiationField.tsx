"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { NegotiationRun } from "../types";
import s from "./numbers.module.css";

const LABELS: Record<string, string> = { polite: "Polite", lowball: "Lowball", injection: "Prompt injection", bundle: "Bundle" };

/**
 * Every negotiation run as one mark, grouped by category and model. Hovering,
 * clicking or arrowing onto a mark shows that run's exchange beside the field.
 */
export function NegotiationField({ runs, models, categories, initial }: { runs: NegotiationRun[]; models: string[]; categories: string[]; initial: number }) {
  const [sel, setSel] = useState(initial);
  const buttons = useRef(new Map<number, HTMLButtonElement>());

  // Rows of run indexes: per category, one row per model, in scenario order.
  const groups = categories.map((cat) => ({
    cat,
    rows: models.map((_, m) =>
      runs
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.category === cat && r.model === m)
        .sort((a, b) => a.r.scenario.localeCompare(b.r.scenario))
        .map(({ i }) => i),
    ),
  }));
  const rows = groups.flatMap((g) => g.rows);
  const order = rows.flat();

  const move = (to: number | undefined) => {
    if (to === undefined) return;
    setSel(to);
    buttons.current.get(to)?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const k = order.indexOf(i);
    const ri = rows.findIndex((row) => row.includes(i));
    const ci = rows[ri]!.indexOf(i);
    const near = (row: number[] | undefined) => (row ? row[Math.min(ci, row.length - 1)] : undefined);
    const to: Record<string, number | undefined> = {
      ArrowRight: order[Math.min(order.length - 1, k + 1)],
      ArrowLeft: order[Math.max(0, k - 1)],
      ArrowDown: near(rows[ri + 1]),
      ArrowUp: near(rows[ri - 1]),
      Home: order[0],
      End: order[order.length - 1],
    };
    if (e.key in to) {
      e.preventDefault();
      move(to[e.key]);
    }
  };

  const r = runs[sel]!;
  return (
    <>
      <div>
        <p className={s.marksCap}>Every run, one mark. Hover or tab through them to read the exchange.</p>
        <div className={s.marks} role="group" aria-label={`The ${runs.length} negotiation runs. Use the arrow keys to move between them.`}>
          {groups.map((g) => (
            <div key={g.cat} className={s.group}>
              <h4>
                {LABELS[g.cat] ?? g.cat}
                <small>{g.rows.reduce((n, row) => n + row.length, 0)} runs</small>
              </h4>
              <div className={s.rows}>
                {g.rows.map((row, m) => (
                  <div key={m} className={s.row}>
                    {row.map((i) => {
                      const run = runs[i]!;
                      return (
                        <button
                          key={i}
                          ref={(el) => {
                            if (el) buttons.current.set(i, el);
                            else buttons.current.delete(i);
                          }}
                          type="button"
                          className={s.mark}
                          data-model={run.model}
                          data-stopped={run.stopped ? "true" : "false"}
                          aria-pressed={i === sel}
                          tabIndex={i === sel ? 0 : -1}
                          aria-label={`${LABELS[run.category] ?? run.category}, ${run.shop}, ${models[run.model]}: ${run.buyer}`}
                          onClick={() => setSel(i)}
                          onPointerEnter={() => setSel(i)}
                          onKeyDown={(e) => onKey(e, i)}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className={s.key}>
          {models.map((m, i) => (
            <span key={m}>
              <i data-model={i} aria-hidden />
              {m}
            </span>
          ))}
          <span>
            <i data-stopped="true" aria-hidden />
            The engine stopped the seller&rsquo;s proposal
          </span>
        </div>
      </div>
      <aside className={s.panel} aria-live="polite">
        <div className={s.meta}>
          <span>
            <b>{LABELS[r.category] ?? r.category}</b>
          </span>
          <span>{r.shop}</span>
          <span>{models[r.model]}</span>
          <span>run {r.scenario}</span>
        </div>
        <div className={s.turn}>
          <div className={s.turnWho}>Buyer agent</div>
          <div className={`${s.say} ${s.buyer}`}>&ldquo;{r.buyer}&rdquo;</div>
        </div>
        <div className={s.turn}>
          <div className={s.turnWho}>Seller agent</div>
          <div className={s.say}>{r.reply}</div>
        </div>
        <div className={s.res}>
          {r.lines.map((line, i) => (
            <div key={i} className={s.ln}>
              <span>
                {line.qty} × {line.product}, {line.attrs}
              </span>
              <b>
                ${line.unit} <span>of ${line.list}</span>
              </b>
            </div>
          ))}
          <div className={s.ln}>
            <span>Discount</span>
            <b>{r.discountPct}%</b>
          </div>
        </div>
        {r.stopped ? <p className={s.stopped}>{r.stopped}</p> : null}
      </aside>
    </>
  );
}
