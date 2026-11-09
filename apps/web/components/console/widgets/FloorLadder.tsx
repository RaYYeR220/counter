"use client";

import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { AgIncompleteDataMappingOverlay, AgNoDataOverlay } from "ag-studio-react";
import { use, type MouseEvent } from "react";
import { money } from "@/lib/console/format";
import type { FloorLadderDef } from "@/lib/console/studio/registry";
import s from "./widgets.module.css";

type Row = Record<string, unknown>;

const VERDICT_TONE: Record<string, string> = { Accepted: "ok", Countered: "warn", Refused: "bad" };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * One rung per negotiation: the list price on the right, the merchant's floor
 * as a hairline, and the haggle drawn between them: the buyer agent's ask
 * (ring), the seller agent's first counter (diamond) and the price it ended on
 * (dot). Asks below the floor land in the hatched zone; the dot never does.
 */
export default function FloorLadder(params: AgWidgetParams<FloorLadderDef>) {
  const { widgetApi, dataMapping, format } = params;
  const m = dataMapping;
  const label = m.label?.at(0);
  const list = m.list?.at(0);
  const ask = m.ask?.at(0);
  const answer = m.answer?.at(0);
  const final = m.final?.at(0);
  const floor = m.floor?.at(0);
  const verdict = m.verdict?.at(0);
  const agent = m.agent?.at(0);
  const time = m.time?.at(0);
  const id = m.id?.at(0);
  if (!label || !list || !ask || !answer || !final || !floor) return <AgIncompleteDataMappingOverlay />;

  const maxRows = Math.min(Math.max(format?.style?.maxRows ?? 12, 1), 100);
  const showFloorValue = format?.style?.showFloorValue ?? true;
  const fields = [label, list, ask, answer, final, floor, verdict, agent, time, id].filter((f): f is AgWidgetField => f != null);
  const response = use(
    widgetApi.getData({
      kind: "flat",
      fields,
      sort: time ? [{ field: time, direction: "desc" }] : undefined,
      limit: { count: maxRows },
    }),
  );
  const rows = response.results.rows as Row[];
  if (rows.length === 0) return <AgNoDataOverlay />;

  const selected = new Set(
    (widgetApi.getCrossFilterSelections() ?? []).flatMap((sel) => (sel.type === "value" ? sel.values : [])).map(String),
  );
  const held = rows.filter((r) => {
    const f = num(r[final.key]);
    const fl = num(r[floor.key]);
    return f != null && fl != null && f >= fl;
  }).length;
  const priced = rows.filter((r) => num(r[final.key]) != null && num(r[floor.key]) != null).length;

  const onRowClick = (e: MouseEvent, value: unknown) => {
    e.stopPropagation();
    widgetApi.toggleCrossFilter({ type: "value", value, field: label, group: 0, reset: !(e.metaKey || e.ctrlKey) });
  };

  return (
    <div className={s.fill} onClick={() => selected.size && widgetApi.resetCrossFilter()}>
      <div className={s.legend} aria-hidden>
        <span className={s.legendItem}>
          <span className={s.legendRing} /> Buyer agent asked
        </span>
        <span className={s.legendItem}>
          <span className={s.legendDiamond} /> Seller agent countered
        </span>
        <span className={s.legendItem}>
          <span className={s.legendDot} /> Agreed price
        </span>
        <span className={s.legendItem}>
          <span className={s.legendFloor} /> Your floor
        </span>
      </div>
      <ol className={`${s.scroll} ${s.ladder}`}>
        {rows.map((r, i) => {
          const L = num(r[list.key]) ?? 0;
          const A = num(r[ask.key]);
          const C = num(r[answer.key]);
          const F = num(r[final.key]);
          const FL = num(r[floor.key]);
          const values = [L, A, C, F, FL].filter((v): v is number => v != null && v > 0);
          const lo = Math.min(...values) * 0.9;
          const hi = L * 1.04;
          const x = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100))}%`;
          const name = String(r[label.key] ?? "");
          const v = verdict ? String(r[verdict.key] ?? "") : "";
          const who = agent ? String(r[agent.key] ?? "") : "";
          const rowId = id ? r[id.key] : undefined;
          const pathFrom = A ?? C;
          return (
            <li
              key={`${rowId ?? name}-${i}`}
              className={s.rung}
              data-selected={selected.has(name)}
              onClick={(e) => onRowClick(e, r[label.key])}
              onContextMenu={(e) =>
                widgetApi.showContextMenu({
                  event: e.nativeEvent,
                  context: { kind: "negotiation", id: rowId ?? null, label: name },
                  filter: id
                    ? { field: id, operator: "equals", value: rowId }
                    : { field: label, operator: "equals", value: r[label.key] },
                })
              }
            >
              <div className={s.rungLabel}>
                <span className={s.rungTitle} title={name}>
                  {name}
                </span>
                <span className={s.rungMeta}>
                  {who ? (
                    <span className={s.agent}>
                      <span>{who}</span>
                    </span>
                  ) : null}
                  <span>list {money(L, true)}</span>
                </span>
              </div>
              <div
                className={s.track}
                role="img"
                aria-label={`${name}: asked ${money(A)}, countered ${money(C)}, agreed ${money(F)}, floor ${money(FL)}, list ${money(L)}`}
              >
                <span className={s.rail} />
                {FL != null ? <span className={s.zone} style={{ width: x(FL) }} /> : null}
                {pathFrom != null && F != null ? (
                  <span
                    className={s.path}
                    style={{ left: x(Math.min(pathFrom, F)), width: `calc(${x(Math.max(pathFrom, F))} - ${x(Math.min(pathFrom, F))})` }}
                  />
                ) : null}
                <span className={s.listTick} style={{ left: x(L) }} />
                {FL != null ? (
                  <>
                    <span className={s.floorLine} style={{ left: x(FL) }} />
                    {showFloorValue ? (
                      <span className={s.floorLabel} style={{ left: x(FL) }}>
                        floor {money(FL)}
                      </span>
                    ) : null}
                  </>
                ) : null}
                {A != null ? <span className={s.ask} style={{ left: x(A) }} title={`Asked ${money(A)}`} /> : null}
                {C != null && C !== F ? <span className={s.answer} style={{ left: x(C) }} title={`Countered ${money(C)}`} /> : null}
                {F != null ? (
                  <>
                    <span className={s.final} style={{ left: x(F) }} title={`Agreed ${money(F)}`} />
                    <span className={s.finalValue} style={{ left: x(F) }}>
                      {money(F)}
                    </span>
                  </>
                ) : null}
              </div>
              <span className={`${s.chip} ${s.verdict}`} data-tone={VERDICT_TONE[v]}>
                {v || "No offer"}
              </span>
            </li>
          );
        })}
      </ol>
      {priced > 0 ? (
        <p className={s.footnote}>
          <strong>
            Floor held in {held} of {priced}
          </strong>{" "}
          negotiations shown. The seller agent&rsquo;s pricing engine refuses any deal below a floor.
        </p>
      ) : null}
    </div>
  );
}
