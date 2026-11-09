"use client";

import { useState } from "react";
import { CopyField } from "@/components/app-shell/CopyField";
import {
  argSummary,
  explainError,
  httpLines,
  msLabel,
  record,
  resultOf,
  TOOL_LABELS,
  toolError,
  usd,
  type HttpLine,
} from "./trace-model";
import type {
  CartView,
  CheckoutOutcome,
  IssueLike,
  NegotiationView,
  OrderStatusView,
  PlaygroundConfig,
  ProductDetail,
  ProductHit,
  ShopSummary,
  StepView,
  ToolError,
} from "./types";
import s from "./playground.module.css";

export interface StepActions {
  config: PlaygroundConfig | null;
  busy: boolean;
  onApproved: () => void;
  /** PayPal orders a later checkout already turned into a placed order. */
  placedOrders: ReadonlySet<string>;
}

/** One tool call in the trace: what was asked, what the shop answered, how long it took. */
export function StepCard({ step, actions }: { step: StepView; actions: StepActions }) {
  const label = TOOL_LABELS[step.tool] ?? step.tool;
  const http = httpLines(step);
  const args = argSummary(step);
  const err = toolError(step);
  return (
    <li className={s.step} data-ok={step.ok}>
      <span className={s.stepIndex} aria-hidden>
        {step.index + 1}
      </span>
      <article className={s.card} aria-label={`Call ${step.index + 1}: ${label}, ${step.ok ? "ok" : "failed"}, ${msLabel(step.ms)}`}>
        <header className={s.cardHead}>
          <div className={s.cardTitle}>
            <strong>{label}</strong>
            <code>{step.tool}</code>
          </div>
          <div className={s.cardMeta}>
            <span className={s.state} data-ok={step.ok}>
              {step.ok ? "ok" : "failed"}
            </span>
            <span className={s.ms}>{msLabel(step.ms)}</span>
          </div>
        </header>
        {http.length ? <HttpReadout lines={http} /> : null}
        {args.length ? (
          <dl className={s.args}>
            {args.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className={s.cardBody}>{err ? <ErrorBody step={step} err={err} config={actions.config} /> : <ResultBody step={step} actions={actions} />}</div>
      </article>
    </li>
  );
}

function HttpReadout({ lines }: { lines: HttpLine[] }) {
  return (
    <ul className={s.http} aria-label="Store Sync requests">
      {lines.map((l, i) => {
        const tone = typeof l.status === "number" && l.status < 400 ? "ok" : "bad";
        return (
          <li key={i}>
            <code className={s.httpReq}>
              <span className={s.httpMethod}>{l.method}</span> {l.path}
            </code>
            <span className={s.httpArrow} aria-label="answered">
              →
            </span>
            <code className={s.httpStatus} data-tone={tone}>
              {l.status}
              {l.name ? ` ${l.name}` : ""}
            </code>
          </li>
        );
      })}
    </ul>
  );
}

function ResultBody({ step, actions }: { step: StepView; actions: StepActions }) {
  switch (step.tool) {
    case "list_shops": {
      const r = resultOf<{ shops: ShopSummary[] }>(step);
      if (r) return <ShopsBody shops={r.shops} />;
      break;
    }
    case "search_products": {
      const r = resultOf<{ query: string; results: ProductHit[] }>(step);
      if (r) return <SearchBody hits={r.results} query={r.query} />;
      break;
    }
    case "get_product": {
      const r = resultOf<ProductDetail>(step);
      if (r?.variants) return <ProductBody product={r} />;
      break;
    }
    case "negotiate": {
      const r = resultOf<NegotiationView>(step);
      if (r?.verdict) return <NegotiateBody n={r} />;
      break;
    }
    case "create_cart":
    case "update_cart": {
      const r = resultOf<CartView>(step);
      if (r?.totals) return <CartBody cart={r} />;
      break;
    }
    case "checkout": {
      const r = resultOf<CheckoutOutcome>(step);
      if (r?.cart) return <CheckoutBody out={r} actions={actions} />;
      break;
    }
    case "order_status": {
      const r = resultOf<OrderStatusView>(step);
      if (r?.payment_status) return <OrderStatusBody o={r} />;
      break;
    }
    default:
      break;
  }
  return <pre className={s.rawText}>{step.text}</pre>;
}

// ---------------------------------------------------------------------------
// Bodies

function ShopsBody({ shops }: { shops: ShopSummary[] }) {
  if (!shops.length) return <p className={s.quiet}>No shops are listed.</p>;
  return (
    <ul className={s.rows}>
      {shops.map((sh) => (
        <li key={sh.shop} className={s.row}>
          <div className={s.rowMain}>
            <strong>{sh.name}</strong>
            <span className={s.quiet}>
              {sh.location ?? "US"} · {sh.categories.join(", ")}
            </span>
          </div>
          <span className={s.rowSide}>{sh.product_count} products</span>
        </li>
      ))}
    </ul>
  );
}

function stockLabel(stock: number, inStock: boolean, purchasable: boolean): { text: string; tone?: "bad" | "warn" } {
  if (!purchasable) return { text: "not sold alone", tone: "warn" };
  if (!inStock || stock <= 0) return { text: "sold out", tone: "bad" };
  return { text: `${stock} in stock` };
}

function SearchBody({ hits, query }: { hits: ProductHit[]; query: string }) {
  const [all, setAll] = useState(false);
  if (!hits.length) return <p className={s.quiet}>Nothing matches “{query}”.</p>;
  const shown = all ? hits : hits.slice(0, 5);
  return (
    <>
      <table className={s.table}>
        <caption className={s.srOnly}>Search results</caption>
        <thead>
          <tr>
            <th scope="col">Variant</th>
            <th scope="col" className={s.num}>
              Price
            </th>
            <th scope="col" className={s.num}>
              Stock
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((h) => {
            const st = stockLabel(h.stock, h.in_stock, h.purchasable);
            return (
              <tr key={`${h.shop}:${h.variant_id}`} data-dim={st.tone === "bad" || !h.purchasable}>
                <td>
                  <span className={s.cellName}>{h.name}</span>
                  <code className={s.id}>{h.variant_id}</code>
                  <span className={s.shopName}>{h.shop_name}</span>
                  {h.flags.length ? <span className={s.flags}>{h.flags.map((f) => f.replace(/_/g, " ")).join(", ")}</span> : null}
                </td>
                <td className={s.num}>{usd(h.price)}</td>
                <td className={s.num} data-tone={st.tone}>
                  {st.text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hits.length > 5 ? (
        <button type="button" className={s.textButton} onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${hits.length} results`}
        </button>
      ) : null}
    </>
  );
}

function ProductBody({ product }: { product: ProductDetail }) {
  return (
    <>
      <p className={s.productHead}>
        <strong>{product.name}</strong> <span className={s.quiet}>at {product.shop_name}</span>
      </p>
      {product.description ? <p className={s.productDesc}>{product.description}</p> : null}
      <ul className={s.variantGrid}>
        {product.variants.map((v) => {
          const st = stockLabel(v.stock, v.in_stock, v.purchasable);
          const values = Object.values(v.attributes).filter(Boolean).join(", ");
          return (
            <li key={v.variant_id} className={s.variantCell} data-dim={st.tone === "bad" || !v.purchasable}>
              <span className={s.variantName}>{values || v.name}</span>
              <code className={s.id}>{v.variant_id}</code>
              <span className={s.variantFacts}>
                <strong>{usd(v.price)}</strong>
                <span data-tone={st.tone}>{st.text}</span>
                {v.lead_time_days > 0 ? <span>{v.lead_time_days} d to make</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const VERDICTS: Record<NegotiationView["verdict"], { text: string; tone: string }> = {
  accept: { text: "Accepted", tone: "ok" },
  clamped: { text: "Countered", tone: "warn" },
  refuse: { text: "Refused", tone: "bad" },
  none: { text: "No deal", tone: "muted" },
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function NegotiateBody({ n }: { n: NegotiationView }) {
  const v = VERDICTS[n.verdict] ?? VERDICTS.none;
  return (
    <>
      <div className={s.sellerSays}>
        <span className={s.chip} data-tone={v.tone}>
          {v.text}
        </span>
        <blockquote>
          <p>{n.reply}</p>
        </blockquote>
      </div>
      {n.offer ? (
        <div className={s.offer}>
          <ul className={s.offerLines}>
            {n.offer.lines.map((l) => {
              const list = Number(l.list_price);
              const unit = Number(l.unit_price);
              const off = list > 0 ? (list - unit) / list : 0;
              // The scale runs from 30% under list to list, so a typical discount reads at a glance.
              const lo = list * 0.7;
              const x = list > lo ? Math.min(100, Math.max(0, ((unit - lo) / (list - lo)) * 100)) : 100;
              return (
                <li key={l.variant_id} className={s.offerLine}>
                  <div className={s.offerWhat}>
                    <span>
                      {l.quantity} × <code className={s.id}>{l.variant_id}</code>
                    </span>
                    <span className={s.offerPrice}>
                      <strong>{usd(l.unit_price)}</strong> each <span className={s.quiet}>list {usd(l.list_price)}</span>
                    </span>
                  </div>
                  <div
                    className={s.scale}
                    role="img"
                    aria-label={`Offer ${usd(l.unit_price)} against list ${usd(l.list_price)}, ${Math.round(off * 100)}% off`}
                  >
                    <span className={s.scaleTrack} />
                    <span className={s.scaleGap} style={{ left: `${x}%`, right: 0 }} />
                    <span className={s.scaleList} />
                    <span className={s.scaleOffer} style={{ left: `${x}%` }} />
                    <span className={s.scaleOff} style={{ left: `${x}%` }}>
                      {off > 0.0005 ? `−${Number((off * 100).toFixed(1))}%` : "list"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className={s.offerFoot}>
            <span>
              {usd(n.offer.discount)} off in total, valid until <time dateTime={n.offer.expires_at}>{timeLabel(n.offer.expires_at)}</time>
            </span>
            <code className={s.id}>{n.offer.offer_id}</code>
          </p>
        </div>
      ) : (
        <p className={s.quiet}>No discount on offer; list prices apply.</p>
      )}
      {n.unknown_items?.length ? <p className={s.warnLine}>Not sold here: {n.unknown_items.join(", ")}</p> : null}
    </>
  );
}

function addressLine(a: CartView["shipping_address"]): string {
  if (!a) return "";
  return [a.address_line_1, a.admin_area_2, [a.admin_area_1, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

function CartBody({ cart }: { cart: CartView }) {
  return (
    <div className={s.cart}>
      <p className={s.cartHead}>
        <span>
          Cart <code className={s.id}>{cart.cart_id}</code>
        </span>
        <span className={s.chip} data-tone={cart.status === "CREATED" || cart.status === "COMPLETED" ? "ok" : "warn"}>
          {cart.status.toLowerCase()}
        </span>
      </p>
      <table className={s.table}>
        <caption className={s.srOnly}>Cart lines</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className={s.num}>
              Qty
            </th>
            <th scope="col" className={s.num}>
              Unit
            </th>
            <th scope="col" className={s.num}>
              Line
            </th>
          </tr>
        </thead>
        <tbody>
          {cart.items.map((i) => (
            <tr key={i.variant_id}>
              <td>
                <span className={s.cellName}>{i.name ?? i.variant_id}</span>
                <code className={s.id}>{i.variant_id}</code>
              </td>
              <td className={s.num}>{i.quantity}</td>
              <td className={s.num}>{usd(i.unit_price)}</td>
              <td className={s.num}>{usd(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cart.shipping_options.length ? (
        <ul className={s.shipping} aria-label="Shipping options">
          {cart.shipping_options.map((o) => (
            <li key={o.id} data-selected={o.selected}>
              <span className={s.radio} aria-hidden />
              <span>
                {o.name}
                {o.selected ? <span className={s.srOnly}> (selected)</span> : null}
              </span>
              <span className={s.quiet}>{o.estimated_delivery ? `arrives by ${o.estimated_delivery}` : ""}</span>
              <span className={s.num}>{usd(o.price)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <dl className={s.totals}>
        <div>
          <dt>Subtotal</dt>
          <dd>{usd(cart.totals.subtotal)}</dd>
        </div>
        {cart.totals.discount && Number(cart.totals.discount) > 0 ? (
          <div data-tone="ok">
            <dt>
              Negotiated discount{" "}
              {cart.discount_codes?.length ? <code className={s.id}>{cart.discount_codes.join(", ")}</code> : null}
            </dt>
            <dd>−{usd(cart.totals.discount)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Shipping</dt>
          <dd>{usd(cart.totals.shipping)}</dd>
        </div>
        <div>
          <dt>Tax</dt>
          <dd>{usd(cart.totals.tax)}</dd>
        </div>
        <div className={s.total}>
          <dt>Total</dt>
          <dd>{usd(cart.totals.total)}</dd>
        </div>
      </dl>
      <p className={s.cartFoot}>
        {cart.shipping_address ? <span>Ships to {addressLine(cart.shipping_address)}</span> : null}
        <span>
          {cart.paypal_order_id ? (
            <>
              PayPal order <code className={s.id}>{cart.paypal_order_id}</code>
            </>
          ) : (
            "No PayPal order yet"
          )}
        </span>
      </p>
      {cart.validation_issues.length ? <Issues issues={cart.validation_issues} /> : null}
    </div>
  );
}

function Issues({ issues }: { issues: IssueLike[] }) {
  return (
    <ul className={s.issues}>
      {issues.map((i, n) => (
        <li key={n}>
          <span>{i.user_message || i.message}</span>
          {i.code ? <code className={s.id}>{i.code}</code> : null}
        </li>
      ))}
    </ul>
  );
}

export function BuyerLogin({ config }: { config: PlaygroundConfig | null }) {
  if (!config?.buyer) {
    return <p className={s.buyerNone}>Sandbox buyer login: ask the shop.</p>;
  }
  return (
    <div className={s.buyerLogin}>
      <p className={s.buyerHint}>Log in to PayPal with the sandbox buyer:</p>
      <div className={s.buyerFields}>
        <CopyField label="Sandbox email" value={config.buyer.email} />
        <CopyField label="Sandbox password" value={config.buyer.password} />
      </div>
    </div>
  );
}

function CheckoutBody({ out, actions }: { out: CheckoutOutcome; actions: StepActions }) {
  if (out.completed && out.order_number) {
    return (
      <div className={s.placed}>
        <p className={s.placedLabel}>Order placed</p>
        <p className={s.orderNumber}>{out.order_number}</p>
        <p className={s.quiet}>
          {usd(out.cart.totals.total)} authorized in PayPal; the shop captures it when it ships.
        </p>
        {out.order_review_page ? (
          <a className={s.secondaryButton} href={out.order_review_page} target="_blank" rel="noopener noreferrer">
            Open the order page
          </a>
        ) : null}
      </div>
    );
  }
  if (out.needs_approval && out.approve_url && out.paypal_order_id && actions.placedOrders.has(out.paypal_order_id)) {
    return (
      <p className={s.quiet}>
        Approved in PayPal; a later checkout placed the order. PayPal order <code className={s.id}>{out.paypal_order_id}</code>
      </p>
    );
  }
  if (out.needs_approval && out.approve_url) {
    return (
      <div className={s.approve}>
        <p className={s.approveLead}>
          The cart is ready: <strong>{usd(out.cart.totals.total)}</strong>. PayPal needs the buyer to approve the payment before the shop can
          authorize it.
        </p>
        <a className={s.primaryButton} href={out.approve_url} target="_blank" rel="noopener noreferrer">
          Approve in PayPal
          <span className={s.srOnly}> (opens a new tab)</span>
        </a>
        <BuyerLogin config={actions.config} />
        <button type="button" className={s.secondaryButton} onClick={actions.onApproved} disabled={actions.busy}>
          I approved — finish the order
        </button>
        {out.paypal_order_id ? (
          <p className={s.quiet}>
            PayPal order <code className={s.id}>{out.paypal_order_id}</code>
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <p>{out.message}</p>
      {out.cart.validation_issues.length ? <Issues issues={out.cart.validation_issues} /> : null}
    </>
  );
}

const PAYMENT_STATUS: Record<string, string> = {
  AWAITING_APPROVAL: "Waiting for the buyer to approve in PayPal",
  APPROVED: "Approved in PayPal, ready to place",
  COMPLETED: "Order placed",
  NOT_STARTED: "No PayPal order yet",
  UNKNOWN: "PayPal doesn't report this payment",
};

function OrderStatusBody({ o }: { o: OrderStatusView }) {
  return (
    <>
      <p>
        <strong>{PAYMENT_STATUS[o.payment_status] ?? o.payment_status}</strong>
      </p>
      {o.order_number ? (
        <p>
          Order <code className={s.id}>{o.order_number}</code>
          {o.order_review_page ? (
            <>
              {" "}
              <a href={o.order_review_page} target="_blank" rel="noopener noreferrer">
                Open the order page
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {o.approve_url && o.payment_status === "AWAITING_APPROVAL" ? (
        <a className={s.secondaryButton} href={o.approve_url} target="_blank" rel="noopener noreferrer">
          Approve in PayPal
        </a>
      ) : null}
    </>
  );
}

function ErrorBody({ step, err, config }: { step: StepView; err: ToolError; config: PlaygroundConfig | null }) {
  const sentence = explainError(step, err, config?.paymentsConnected);
  const unconnected = err.name === "PAYMENT_PROCESSOR_UNAVAILABLE" && config?.paymentsConnected === false;
  const raw = record(err)?.message;
  return (
    <div className={s.errorBody} data-kind={unconnected ? "rail" : undefined}>
      <p>{sentence}</p>
      {err.issues?.length ? <Issues issues={err.issues} /> : null}
      {typeof raw === "string" && raw && raw !== sentence ? (
        <p className={s.shopSaid}>
          <span>The shop answered:</span> {raw}
        </p>
      ) : null}
    </div>
  );
}
