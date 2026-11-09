"use client";

import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { AgIncompleteDataMappingOverlay, AgNoDataOverlay } from "ag-studio-react";
import { use } from "react";
import { money } from "@/lib/console/format";
import type { MarketPositionDef } from "@/lib/console/studio/registry";
import s from "./widgets.module.css";

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Where each product's price sits against what other sellers charge: a scale
 * per product with the market's middle half as a band, the median as a tick,
 * your price as a pointer and your floor as the same red hairline the
 * negotiation ladder uses.
 */
export default function MarketPosition(params: AgWidgetParams<MarketPositionDef>) {
  const { widgetApi, dataMapping, format } = params;
  const label = dataMapping.label?.at(0);
  const price = dataMapping.price?.at(0);
  const low = dataMapping.low?.at(0);
  const median = dataMapping.median?.at(0);
  const high = dataMapping.high?.at(0);
  const floor = dataMapping.floor?.at(0);
  if (!label || !price || !low || !median || !high) return <AgIncompleteDataMappingOverlay />;

  const maxRows = Math.min(Math.max(format?.style?.maxRows ?? 20, 1), 100);
  const fields = [label, price, low, median, high, floor].filter((f): f is AgWidgetField => f != null);
  const response = use(widgetApi.getData({ fields, sort: [{ field: label, direction: "asc" }], limit: { count: maxRows } }));
  const rows = (response.results.rows as Row[]).filter((r) => num(r[median.key]) != null);
  if (rows.length === 0) return <AgNoDataOverlay />;

  const counts = { below: 0, within: 0, above: 0 };

  const items = rows.map((r, i) => {
    const P = num(r[price.key]) ?? 0;
    const lo = num(r[low.key]) ?? 0;
    const md = num(r[median.key]) ?? 0;
    const hi = num(r[high.key]) ?? 0;
    const fl = floor ? num(r[floor.key]) : null;
    const min = Math.min(lo, P, fl ?? P) * 0.88;
    const max = Math.max(hi, P) * 1.08;
    const x = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min || 1)) * 100))}%`;
    const where = P < lo ? "below" : P > hi ? "above" : "within";
    counts[where] += 1;
    const delta = md > 0 ? (P - md) / md : 0;
    const name = String(r[label.key] ?? "");
    return (
      <li key={`${name}-${i}`} className={s.instrumentRow}>
        <div className={s.rungLabel}>
          <span className={s.rungTitle} title={name}>
            {name}
          </span>
          <span className={s.rungMeta}>
            market {money(lo, true)}–{money(hi, true)}
          </span>
        </div>
        <div
          className={s.gauge}
          role="img"
          aria-label={`${name}: your price ${money(P)}, market ${money(lo)} to ${money(hi)}, median ${money(md)}`}
        >
          <span className={s.scale} />
          <span className={s.band} style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
          <span className={s.median} style={{ left: x(md) }} title={`Median ${money(md)}`} />
          {fl != null ? <span className={s.floorLine} style={{ left: x(fl), top: 8, height: 25 }} title={`Floor ${money(fl)}`} /> : null}
          <span className={s.ours} style={{ left: x(P) }} title={`Your price ${money(P)}`} />
          <span className={s.gaugeLabel} style={{ left: x(md) }}>
            median {money(md, true)}
          </span>
        </div>
        <div className={s.price}>
          <strong>{money(P)}</strong>
          <span className={s.delta} data-tone={delta > 0.005 ? "up" : delta < -0.005 ? "down" : undefined}>
            {delta >= 0 ? "+" : "−"}
            {Math.abs(delta * 100).toFixed(0)}% vs median
          </span>
          <span className={s.chip} data-tone={where === "within" ? "ok" : where === "above" ? "warn" : "accent"}>
            {where === "within" ? "In range" : where === "above" ? "Above market" : "Below market"}
          </span>
        </div>
      </li>
    );
  });

  return (
    <div className={s.fill}>
      <div className={s.legend} aria-hidden>
        <span className={s.legendItem}>
          <span className={s.legendDot} style={{ borderRadius: 0, width: 2, height: 12 }} /> Your price
        </span>
        <span className={s.legendItem}>
          <span className={s.legendDiamond} style={{ transform: "none", width: 14, height: 9, background: "var(--cx-surface-3)", border: "1px solid var(--cx-line-strong)" }} />{" "}
          Middle half of other sellers
        </span>
        <span className={s.legendItem}>
          <span className={s.legendFloor} style={{ borderColor: "var(--cx-ink-2)", borderLeftWidth: 2 }} /> Median
        </span>
        <span className={s.legendItem}>
          <span className={s.legendFloor} /> Your floor
        </span>
      </div>
      <ol className={`${s.scroll} ${s.instrument}`}>{items}</ol>
      <p className={s.footnote}>
        <strong>{counts.within}</strong> in range, <strong>{counts.above}</strong> above and <strong>{counts.below}</strong> below what other sellers charge.
      </p>
    </div>
  );
}
