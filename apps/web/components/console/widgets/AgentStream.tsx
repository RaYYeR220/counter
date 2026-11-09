"use client";

import type { AgDataHandle, AgWidgetDataQuery, AgWidgetField, AgWidgetParams } from "ag-studio";
import { AgIncompleteDataMappingOverlay, AgLoadingOverlay, AgNoDataOverlay } from "ag-studio-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ago, money } from "@/lib/console/format";
import type { AgentStreamDef } from "@/lib/console/studio/registry";
import s from "./widgets.module.css";

type Row = Record<string, unknown>;

const TONES: Array<[RegExp, string]> = [
  [/authorized|shipped|captured|accepted/i, "ok"],
  [/countered|cancelled|refunded/i, "warn"],
  [/refused|declined|failed|dispute/i, "bad"],
];

function toneOf(event: string): string | undefined {
  return TONES.find(([re]) => re.test(event))?.[1];
}

/**
 * A live ticker of what agents are doing at the shop: newest first, one line
 * per event with the agent, what happened, the cart total and the server
 * latency. Rows arrive through a data handle as live-data transactions land,
 * and new ones flash once. Clicking an agent cross-filters the page to it;
 * right-clicking a row opens the Console's menu for what the row is about.
 */
export default function AgentStream(params: AgWidgetParams<AgentStreamDef>) {
  const { widgetApi, dataMapping, format } = params;
  const time = dataMapping.time?.at(0);
  const agent = dataMapping.agent?.at(0);
  const event = dataMapping.event?.at(0);
  const amount = dataMapping.amount?.at(0);
  const reference = dataMapping.reference?.at(0);
  const latency = dataMapping.latency?.at(0);
  const maxRows = Math.min(Math.max(format?.style?.maxRows ?? 40, 5), 200);
  const showLatency = format?.style?.showLatency ?? true;

  const [data, setData] = useState<{ rows: Row[]; fresh: Set<string> } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastKeys = useRef<Set<string> | null>(null);
  const keyOf = useMemo(
    () => (r: Row) => [time, event, reference, agent].map((f) => (f ? String(r[f.key] ?? "") : "")).join("|"),
    [time, event, reference, agent],
  );

  const query = useMemo<AgWidgetDataQuery | null>(() => {
    if (!time || !agent || !event) return null;
    const fields = [time, agent, event, amount, reference, latency].filter((f): f is AgWidgetField => f != null);
    return { kind: "flat", fields, sort: [{ field: time, direction: "desc" }], limit: { count: maxRows } };
  }, [time, agent, event, amount, reference, latency, maxRows]);

  // One data handle per query: it delivers the rows again whenever a transaction
  // adds events or a filter changes, until the effect closes it.
  useEffect(() => {
    if (!query) return;
    const h: AgDataHandle = widgetApi.getDataHandle();
    h.open(({ results }) => {
      for (const r of results) {
        if (r.key !== "rows") continue;
        const rows = (r.response.results as { rows: Row[] }).rows;
        const keys = new Set(rows.map(keyOf));
        const before = lastKeys.current;
        lastKeys.current = keys;
        setData({ rows, fresh: before ? new Set([...keys].filter((k) => !before.has(k))) : new Set() });
      }
    });
    h.set("rows", { query });
    return () => h.close();
  }, [query, keyOf, widgetApi]);

  // Relative times tick on their own.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  if (!time || !agent || !event) return <AgIncompleteDataMappingOverlay />;
  if (data == null) return <AgLoadingOverlay />;
  const { rows, fresh } = data;
  if (rows.length === 0) return <AgNoDataOverlay />;
  const keys = rows.map(keyOf);

  const selected = new Set(
    (widgetApi.getCrossFilterSelections() ?? []).flatMap((sel) => (sel.type === "value" ? sel.values : [])).map(String),
  );

  const filterAgent = (e: MouseEvent, value: unknown) => {
    e.stopPropagation();
    widgetApi.toggleCrossFilter({ type: "value", value, field: agent, group: 0, reset: !(e.metaKey || e.ctrlKey) });
  };

  return (
    <div className={s.fill} onClick={() => selected.size && widgetApi.resetCrossFilter()}>
      <ol className={`${s.scroll} ${s.stream}`} aria-live="polite" aria-label="Latest agent activity">
        {rows.map((r, i) => {
          const who = String(r[agent.key] ?? "Unattributed");
          const what = String(r[event.key] ?? "");
          const ref = reference ? (r[reference.key] as string | null) : null;
          const total = amount ? (r[amount.key] as number | null) : null;
          const ms = latency ? (r[latency.key] as number | null) : null;
          const at = r[time.key] as string | number;
          const tone = toneOf(what);
          return (
            <li
              key={keys[i]}
              className={s.streamRow}
              data-new={fresh.has(keys[i]!)}
              onContextMenu={(e) =>
                widgetApi.showContextMenu({
                  event: e.nativeEvent,
                  context: { kind: "event", ref, event: what, agent: who },
                  filter: { field: agent, operator: "equals", value: r[agent.key] },
                })
              }
            >
              <span className={s.time}>{at ? ago(at, now) : ""}</span>
              <button
                type="button"
                className={s.agentButton}
                aria-pressed={selected.has(who)}
                title={`Show only ${who}`}
                onClick={(e) => filterAgent(e, r[agent.key])}
              >
                <span className={s.agent}>
                  <span>{who}</span>
                </span>
              </button>
              <span className={s.what}>
                {tone ? (
                  <span className={s.chip} data-tone={tone}>
                    {what}
                  </span>
                ) : (
                  what
                )}
                {ref && !/CART-/.test(ref) ? <span className={s.ref}>{ref}</span> : null}
              </span>
              <span className={s.amount}>{total != null ? money(total) : ""}</span>
              {showLatency ? <span className={s.latency}>{ms != null ? `${ms} ms` : ""}</span> : <span />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
