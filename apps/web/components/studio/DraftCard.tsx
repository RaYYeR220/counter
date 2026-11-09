"use client";

import { useId, useState } from "react";
import { floorParts, floorReason, type FloorSource } from "./floor";
import type { ProductDraft } from "./types";
import s from "./studio.module.css";

export interface EditableDraft {
  key: number;
  draft: ProductDraft;
  /** Where each variant's floor came from, in variant order. */
  floorSources: FloorSource[];
  /** Variants whose floor the merchant typed; those stop following the rule. */
  floorEdited: boolean[];
}

type Variant = ProductDraft["variants"][number];
type Market = NonNullable<ProductDraft["market"]>;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The problems the publisher would refuse, checked as the merchant edits. */
export function draftProblemsOf(d: ProductDraft): string[] {
  const out: string[] = [];
  const name = d.name.trim() || "A product";
  if (!d.name.trim()) out.push("A product has no name.");
  for (const v of d.variants) {
    const values = Object.values(v.attributes).filter(Boolean);
    const label = values.length ? `${name} (${values.join(", ")})` : name;
    if (!(v.priceCents > 0)) out.push(`${label}: set a price above $0.`);
    else if (v.floorCents < 0 || v.floorCents > v.priceCents) out.push(`${label}: the floor must be between $0 and the price.`);
    if (!Number.isInteger(v.stock) || v.stock < 0) out.push(`${label}: stock must be a whole number, 0 or more.`);
  }
  return out;
}

function parseCents(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** A dollar amount field that keeps what the merchant types and commits whole cents. */
function MoneyInput({
  cents,
  label,
  onCommit,
  invalid,
  className,
}: {
  cents: number;
  label: string;
  onCommit: (cents: number) => void;
  invalid?: boolean;
  className?: string;
}) {
  // What the merchant is typing, while the field has focus; otherwise the committed amount shows.
  const [typing, setTyping] = useState<string | null>(null);
  const text = typing ?? (cents / 100).toFixed(2);
  return (
    <span className={`${s.money} ${className ?? ""}`}>
      <span aria-hidden>$</span>
      <input
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || parseCents(text) === null || undefined}
        value={text}
        onFocus={() => setTyping((cents / 100).toFixed(2))}
        onBlur={() => setTyping(null)}
        onChange={(e) => {
          setTyping(e.target.value);
          const c = parseCents(e.target.value);
          if (c !== null) onCommit(c);
        }}
      />
    </span>
  );
}

function sourceLabel(d: ProductDraft): string {
  const src = d.source;
  if (src.kind === "url") {
    try {
      return `From ${new URL(src.ref ?? "").hostname.replace(/^www\./, "")}`;
    } catch {
      return "From a product page";
    }
  }
  if (src.kind === "photo") return src.ref ? `From the photo ${src.ref}` : "From a photo";
  return src.ref ? `From CSV ${src.ref}` : "From CSV";
}

/** One imported product, editable before publishing. */
export function DraftCard({
  value,
  maxDiscountPct,
  onChange,
  onRemove,
}: {
  value: EditableDraft;
  maxDiscountPct: number;
  onChange: (next: EditableDraft) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const d = value.draft;
  const setDraft = (patch: Partial<ProductDraft>) => onChange({ ...value, draft: { ...d, ...patch } });

  const setVariant = (i: number, patch: Partial<Variant>, opts: { floorTyped?: boolean } = {}) => {
    const variants = d.variants.map((v, j) => (j === i ? { ...v, ...patch } : v));
    const floorEdited = value.floorEdited.map((e, j) => (j === i && opts.floorTyped ? true : e));
    const floorSources = [...value.floorSources];
    const v = variants[i]!;
    // A floor the merchant hasn't typed follows the rule when the price changes.
    if (!floorEdited[i] && "priceCents" in patch) {
      const parts = floorParts(v.priceCents, v.costCents, d.market?.lowCents, maxDiscountPct);
      variants[i] = { ...v, floorCents: parts.floorCents };
      floorSources[i] = parts.source;
    }
    onChange({ ...value, draft: { ...d, variants }, floorEdited, floorSources });
  };

  const attrNames = d.attributesOrder.length ? d.attributesOrder : Object.keys(d.variants[0]?.attributes ?? {});

  return (
    <article className={s.draft} aria-labelledby={`${id}-name`}>
      <header className={s.draftHead}>
        <label className={s.nameField}>
          <span className={s.srOnly} id={`${id}-name`}>
            Product: {d.name}
          </span>
          <input value={d.name} maxLength={200} onChange={(e) => setDraft({ name: e.target.value })} aria-label="Product name" />
        </label>
        <span className={s.source}>{sourceLabel(d)}</span>
        <button type="button" className={s.linkButton} onClick={onRemove}>
          Remove draft
        </button>
      </header>

      <div className={s.draftFields}>
        <label className={s.field}>
          <span>Category</span>
          <input value={d.category} maxLength={80} onChange={(e) => setDraft({ category: e.target.value })} />
        </label>
        <label className={`${s.field} ${s.grow}`}>
          <span>Description</span>
          <textarea rows={2} value={d.description} maxLength={4000} onChange={(e) => setDraft({ description: e.target.value })} />
        </label>
      </div>

      {d.warnings.length ? (
        <ul className={s.warnings} aria-label="Check before publishing">
          {d.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      {d.market ? <MarketCheck market={d.market} draft={d} /> : <p className={s.hint}>No market check for this draft: floors follow the discount limit and cost only.</p>}

      <div className={s.tableWrap}>
        <table className={s.variants}>
          <caption className={s.srOnly}>Variants of {d.name}</caption>
          <thead>
            <tr>
              <th scope="col">Variant</th>
              <th scope="col">Price</th>
              <th scope="col">Stock</th>
              <th scope="col">Floor</th>
              <th scope="col">Why this floor</th>
            </tr>
          </thead>
          <tbody>
            {d.variants.map((v, i) => {
              const values = attrNames.map((k) => v.attributes[k]).filter(Boolean);
              const label = values.length ? values.join(", ") : "Single variant";
              const parts = floorParts(v.priceCents, v.costCents, d.market?.lowCents, maxDiscountPct);
              const src = value.floorSources[i] ?? "given";
              const floorBad = v.floorCents > v.priceCents;
              return (
                <tr key={i}>
                  <th scope="row">
                    <span className={s.variantLabel}>{label}</span>
                    {v.variantId ? <code className={s.id}>{v.variantId}</code> : null}
                    {v.costCents ? <span className={s.hint}>cost {money(v.costCents)}</span> : null}
                  </th>
                  <td>
                    <MoneyInput
                      cents={v.priceCents}
                      label={`Price, ${label}`}
                      invalid={!(v.priceCents > 0)}
                      onCommit={(c) => setVariant(i, { priceCents: c })}
                    />
                  </td>
                  <td>
                    <input
                      className={s.stock}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      aria-label={`Stock, ${label}`}
                      value={Number.isFinite(v.stock) ? v.stock : 0}
                      onChange={(e) => {
                        const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                        setVariant(i, { stock: n });
                      }}
                    />
                  </td>
                  <td>
                    <MoneyInput
                      className={s.floorMoney}
                      cents={v.floorCents}
                      label={`Floor, ${label}`}
                      invalid={floorBad}
                      onCommit={(c) => setVariant(i, { floorCents: c }, { floorTyped: true })}
                    />
                    {v.priceCents > 0 ? (
                      <span className={s.hint}>{Math.max(0, Math.round(((v.priceCents - v.floorCents) / v.priceCents) * 100))}% under list</span>
                    ) : null}
                  </td>
                  <td className={s.why}>
                    {value.floorEdited[i]
                      ? floorBad
                        ? "Set by you, but above the price."
                        : "Set by you."
                      : floorReason(parts, src, maxDiscountPct, d.source.kind)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

const POSITION: Record<Market["position"], string> = {
  below: "Below the market",
  within: "Within the market",
  above: "Above the market",
};

function MarketCheck({ market, draft }: { market: Market; draft: ProductDraft }) {
  // The variant that was compared: the one priced as checked, else the median-priced one.
  const priced = draft.variants.filter((v) => v.priceCents > 0).sort((a, b) => a.priceCents - b.priceCents);
  const ref = draft.variants.find((v) => v.priceCents === market.priceCents) ?? priced[Math.floor((priced.length - 1) / 2)] ?? draft.variants[0];
  const ours = ref?.priceCents ?? market.priceCents ?? market.medianCents;
  const floor = ref?.floorCents ?? 0;
  const position: Market["position"] = ours < market.lowCents ? "below" : ours > market.highCents ? "above" : "within";
  const min = Math.min(market.lowCents, ours, floor || ours) * 0.88;
  const max = Math.max(market.highCents, ours) * 1.08;
  const x = (c: number) => `${Math.min(100, Math.max(0, ((c - min) / (max - min || 1)) * 100))}%`;
  const delta = market.medianCents > 0 ? (ours - market.medianCents) / market.medianCents : 0;
  const checked = new Date(market.checkedAt);

  return (
    <div className={s.market}>
      <div className={s.marketHead}>
        <p>
          <strong>Market check</strong>{" "}
          <span className={s.quiet}>
            {market.comparable.length} comparable listing{market.comparable.length === 1 ? "" : "s"}
            {Number.isNaN(checked.getTime()) ? "" : `, checked ${checked.toLocaleDateString([], { month: "short", day: "numeric" })}`}
          </span>
        </p>
        <span className={s.chip} data-tone={position === "within" ? "ok" : "warn"}>
          {POSITION[position]}
        </span>
      </div>
      <div
        className={s.gauge}
        role="img"
        aria-label={`Your price ${money(ours)}; market ${money(market.lowCents)} to ${money(market.highCents)}, median ${money(market.medianCents)}; floor ${money(floor)}`}
      >
        <span className={s.gaugeScale} />
        <span className={s.gaugeBand} style={{ left: x(market.lowCents), width: `calc(${x(market.highCents)} - ${x(market.lowCents)})` }} />
        <span className={s.gaugeMedian} style={{ left: x(market.medianCents) }} />
        {floor > 0 ? <span className={s.gaugeFloor} style={{ left: x(floor) }} /> : null}
        <span className={s.gaugeOurs} style={{ left: x(ours) }} />
      </div>
      <dl className={s.marketStats}>
        <div>
          <dt>Low</dt>
          <dd>{money(market.lowCents)}</dd>
        </div>
        <div>
          <dt>Median</dt>
          <dd>{money(market.medianCents)}</dd>
        </div>
        <div>
          <dt>High</dt>
          <dd>{money(market.highCents)}</dd>
        </div>
        <div data-ours>
          <dt>Yours</dt>
          <dd>
            {money(ours)}{" "}
            <span className={s.quiet}>
              ({delta >= 0 ? "+" : "−"}
              {Math.abs(delta * 100).toFixed(0)}% vs median)
            </span>
          </dd>
        </div>
        {floor > 0 ? (
          <div data-floor>
            <dt>Floor</dt>
            <dd>{money(floor)}</dd>
          </div>
        ) : null}
      </dl>
      {market.comparable.length ? (
        <details className={s.comparables}>
          <summary>See the comparable listings</summary>
          <ul>
            {market.comparable.slice(0, 12).map((c, i) => (
              <li key={i}>
                {/^https?:\/\//i.test(c.url) ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">
                    {c.title}
                  </a>
                ) : (
                  <span>{c.title}</span>
                )}
                <span className={s.quiet}>{c.merchant}</span>
                <span className={s.num}>{money(c.priceCents)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
