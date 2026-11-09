"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { removeLine, setLineQuantity, useCart, useHydrated } from "@/lib/storefront/cart-store";
import { displayValue, flagLabel, formatDay, money, US_STATES } from "@/lib/storefront/format";
import { productHref } from "@/lib/storefront/pick";
import type { CartLineInput, CheckoutResponse, Quote, QuoteLine } from "@/lib/storefront/types";
import cs from "./cart.module.css";
import { ProductArt } from "./ProductArt";
import s from "./sf.module.css";

type ShippingId = "STANDARD" | "EXPRESS";

const NOTICES: Record<string, { title: string; text: string; error: boolean }> = {
  cancelled: { title: "Payment not approved", text: "You left PayPal before approving. Nothing was charged, and your cart is still here.", error: false },
  declined: { title: "PayPal declined the payment", text: "Nothing was charged. Check out again to choose another way to pay in PayPal.", error: true },
  expired: { title: "The PayPal approval expired", text: "Nothing was charged. Check out again to approve the current total.", error: true },
  invalid: { title: "Your cart changed", text: "Stock or prices changed before the payment went through. Nothing was charged; review your cart and check out again.", error: true },
  not_configured: { title: "Payments are not configured", text: "This shop can't take payments yet. Nothing was charged.", error: true },
  unknown: { title: "We couldn't match that payment", text: "Nothing was charged. Check out again from this cart.", error: true },
  missing: { title: "We couldn't match that payment", text: "Nothing was charged. Check out again from this cart.", error: true },
  error: { title: "We couldn't confirm your payment", text: "Nothing was charged. Try checking out again in a minute.", error: true },
};

interface AddressState {
  given_name: string;
  surname: string;
  address_line_1: string;
  address_line_2: string;
  admin_area_2: string;
  admin_area_1: string;
  postal_code: string;
}

const EMPTY_ADDRESS: AddressState = {
  given_name: "",
  surname: "",
  address_line_1: "",
  address_line_2: "",
  admin_area_2: "",
  admin_area_1: "",
  postal_code: "",
};

function QuantityField({ id, label, quantity, max, onCommit }: {
  id: string;
  label: string;
  quantity: number;
  max: number | undefined;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className={cs.qtyField}>
      <label htmlFor={id}>
        Quantity<span className={s.srOnly}> of {label}</span>
      </label>
      <input
        id={id}
        className={cs.qtyInput}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        step={1}
        value={draft ?? String(quantity)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n) && n >= 1) onCommit(Math.min(n, 999));
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

function LineItem({ shop, line, info, issue, onRemove }: {
  shop: string;
  line: CartLineInput;
  info: QuoteLine | undefined;
  issue: string | undefined;
  onRemove: () => void;
}) {
  const id = useId();
  const name = info?.name ?? line.variant_id;
  return (
    <li className={cs.line}>
      <div className={cs.thumb}>
        {info ? (
          <ProductArt
            subject={{
              category: info.category,
              parentId: info.parent_id,
              productName: info.product_name,
              attributes: Object.fromEntries(info.attributes.map((a) => [a.key, a.value])),
              flags: info.flags,
            }}
            decorative
            crop
          />
        ) : null}
      </div>
      <div>
        <h3 className={cs.lineName}>
          {info ? <Link href={productHref(shop, info.parent_id, info.variant_id)}>{info.product_name}</Link> : name}
        </h3>
        {info?.attributes.length ? (
          <dl className={cs.attrs}>
            {info.attributes.map((a) => (
              <div key={a.key}>
                <dt>{a.label}:</dt>
                <dd>{displayValue(a.value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {info ? (
          <p className={cs.lineMeta}>
            {money(info.unit_cents)} each
            {info.flags.length ? `, ${info.flags.map(flagLabel).join(", ")}` : ""}
          </p>
        ) : null}
        {issue ? <p className={cs.lineIssue}>{issue}</p> : null}
      </div>
      <div className={cs.lineControls}>
        <QuantityField
          id={`${id}-qty`}
          label={name}
          quantity={line.quantity}
          max={info && info.stock > 0 ? info.stock : undefined}
          onCommit={(n) => setLineQuantity(shop, line.variant_id, n)}
        />
        {info ? <span className={cs.lineTotal}>{money(info.unit_cents * line.quantity)}</span> : null}
        <button type="button" className={cs.remove} onClick={onRemove} aria-label={`Remove ${name}`}>
          Remove
        </button>
      </div>
    </li>
  );
}

export function CartView({ shop, shopName, notice }: { shop: string; shopName: string; notice: string | null }) {
  const uid = useId();
  const lines = useCart(shop);
  const hydrated = useHydrated();
  const [address, setAddress] = useState<AddressState>(EMPTY_ADDRESS);
  const [option, setOption] = useState<ShippingId>("STANDARD");
  const [quoted, setQuoted] = useState<{ key: string; quote: Quote } | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const lastTotal = useRef<string | null>(null);

  const linesKey = JSON.stringify(lines);
  const state = address.admin_area_1;
  const quoteKey = JSON.stringify([linesKey, state, option]);
  const quote = quoted?.quote ?? null;
  // The quote on screen was priced for a different cart, state or shipping method.
  const stale = quoted !== null && quoted.key !== quoteKey;

  useEffect(() => {
    const current = JSON.parse(linesKey) as CartLineInput[];
    if (!current.length) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/storefront/${encodeURIComponent(shop)}/quote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lines: current,
            shipping_address: { country_code: "US", ...(state ? { admin_area_1: state } : {}) },
            shipping_option: option,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`quote ${res.status}`);
        const q = (await res.json()) as Quote;
        setQuoted({ key: JSON.stringify([linesKey, state, option]), quote: q });
        setQuoteFailed(false);
        const text = `Order total ${money(q.total_cents)}${q.tax_pending ? " before tax" : ""}`;
        if (lastTotal.current !== null && lastTotal.current !== text) setAnnouncement(text);
        lastTotal.current = text;
      } catch {
        if (!ctrl.signal.aborted) setQuoteFailed(true);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [shop, linesKey, state, option]);

  function field(key: keyof AddressState) {
    return {
      id: `${uid}-${key}`,
      name: key,
      value: address[key],
      onChange: (e: { target: { value: string } }) => setAddress((a) => ({ ...a, [key]: e.target.value })),
    };
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    let data: CheckoutResponse;
    try {
      const res = await fetch(`/api/storefront/${encodeURIComponent(shop)}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines,
          customer: { given_name: address.given_name, surname: address.surname },
          shipping_address: {
            address_line_1: address.address_line_1,
            ...(address.address_line_2.trim() ? { address_line_2: address.address_line_2 } : {}),
            admin_area_2: address.admin_area_2,
            admin_area_1: address.admin_area_1,
            postal_code: address.postal_code,
            country_code: "US",
          },
          shipping_option: option,
        }),
      });
      data = (await res.json()) as CheckoutResponse;
    } catch {
      data = { status: "error", message: "We couldn't reach the shop. Check your connection and try again." };
    }
    setResult(data);
    if (data.status === "redirect") {
      window.location.assign(data.approval_url);
      return;
    }
    if (data.status === "bench") {
      window.location.assign(data.handoff_url);
      return;
    }
    setBusy(false);
  }

  const banner = notice ? NOTICES[notice] : undefined;

  if (!hydrated) {
    return (
      <>
        <h1 className={s.pageTitle}>Your cart</h1>
        <p className={s.muted} role="status" style={{ marginTop: 16 }}>
          Loading your cart…
        </p>
      </>
    );
  }

  if (!lines.length) {
    return (
      <>
        <h1 className={s.pageTitle}>Your cart</h1>
        {banner ? (
          <div className={banner.error ? s.noticeError : s.notice} role="alert" style={{ marginTop: 20 }}>
            <p className={s.noticeTitle}>{banner.title}</p>
            <p>{banner.text}</p>
          </div>
        ) : null}
        <div className={cs.empty}>
          <p>Your cart is empty.</p>
          <Link href={`/s/${shop}`} className={s.button}>
            Browse {shopName}
          </Link>
        </div>
      </>
    );
  }

  const byId = new Map((quote?.lines ?? []).map((l) => [l.variant_id, l]));
  const issueFor = (variantId: string) => {
    if (quote?.unknown.includes(variantId)) return "This item is no longer sold here. Remove it to check out.";
    return quote?.issues.find((i) => i.variant_id === variantId)?.message;
  };
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
  const subtotal = lines.reduce((n, l) => n + (byId.get(l.variant_id)?.unit_cents ?? 0) * l.quantity, 0);
  const selected = quote?.shipping_options.find((o) => o.is_selected);
  const blocked = quote !== null && (quote.validation_status === "INVALID" || quote.unknown.length > 0);
  const generalIssues = (quote?.issues ?? []).filter((i) => !i.variant_id);
  const stateName = US_STATES.find(([code]) => code === state)?.[1];
  const done = result?.status === "bench";

  return (
    <>
      <h1 className={s.pageTitle}>Your cart</h1>
      {banner ? (
        <div className={banner.error ? s.noticeError : s.notice} role="alert" style={{ marginTop: 20 }}>
          <p className={s.noticeTitle}>{banner.title}</p>
          <p>{banner.text}</p>
        </div>
      ) : null}

      <div className={cs.layout}>
        <div>
          <h2 className={s.srOnly}>Items</h2>
          <ul className={cs.lines}>
            {lines.map((line) => (
              <LineItem
                key={line.variant_id}
                shop={shop}
                line={line}
                info={byId.get(line.variant_id)}
                issue={issueFor(line.variant_id)}
                onRemove={() => removeLine(shop, line.variant_id)}
              />
            ))}
          </ul>
          <p style={{ marginTop: 16 }}>
            <Link href={`/s/${shop}`} className={s.link}>
              Continue shopping
            </Link>
          </p>

          <form id={`${uid}-checkout`} className={cs.form} onSubmit={onSubmit} aria-label="Shipping and checkout">
            <fieldset className={cs.fieldset}>
              <legend className={cs.legend}>Shipping address</legend>
              <div className={`${cs.row} ${cs.row2}`}>
                <div className={cs.field}>
                  <label htmlFor={`${uid}-given_name`} className={cs.label}>
                    First name
                  </label>
                  <input {...field("given_name")} className={cs.input} autoComplete="shipping given-name" required maxLength={140} />
                </div>
                <div className={cs.field}>
                  <label htmlFor={`${uid}-surname`} className={cs.label}>
                    Last name
                  </label>
                  <input {...field("surname")} className={cs.input} autoComplete="shipping family-name" required maxLength={140} />
                </div>
              </div>
              <div className={cs.field}>
                <label htmlFor={`${uid}-address_line_1`} className={cs.label}>
                  Street address
                </label>
                <input {...field("address_line_1")} className={cs.input} autoComplete="shipping address-line1" required maxLength={300} />
              </div>
              <div className={cs.field}>
                <label htmlFor={`${uid}-address_line_2`} className={cs.label}>
                  Apartment, suite, etc. <span className={cs.optional}>(optional)</span>
                </label>
                <input {...field("address_line_2")} className={cs.input} autoComplete="shipping address-line2" maxLength={300} />
              </div>
              <div className={`${cs.row} ${cs.row3}`}>
                <div className={cs.field}>
                  <label htmlFor={`${uid}-admin_area_2`} className={cs.label}>
                    City
                  </label>
                  <input {...field("admin_area_2")} className={cs.input} autoComplete="shipping address-level2" required maxLength={120} />
                </div>
                <div className={cs.field}>
                  <label htmlFor={`${uid}-admin_area_1`} className={cs.label}>
                    State
                  </label>
                  <select {...field("admin_area_1")} className={cs.input} autoComplete="shipping address-level1" required>
                    <option value="">Choose…</option>
                    {US_STATES.map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={cs.field}>
                  <label htmlFor={`${uid}-postal_code`} className={cs.label}>
                    ZIP code
                  </label>
                  <input
                    {...field("postal_code")}
                    className={cs.input}
                    autoComplete="shipping postal-code"
                    inputMode="numeric"
                    pattern="[0-9]{5}(-[0-9]{4})?"
                    title="5-digit ZIP code"
                    required
                    maxLength={10}
                  />
                </div>
              </div>
              <div className={cs.field}>
                <label htmlFor={`${uid}-country`} className={cs.label}>
                  Country
                </label>
                <input id={`${uid}-country`} className={cs.input} value="United States" readOnly aria-describedby={`${uid}-country-hint`} />
                <p id={`${uid}-country-hint`} className={cs.hint}>
                  We ship to US addresses only.
                </p>
              </div>
            </fieldset>

            <fieldset className={cs.fieldset}>
              <legend className={cs.legend}>Shipping method</legend>
              {quote ? (
                <div className={cs.methods}>
                  {quote.shipping_options.map((o) => (
                    <label key={o.id} className={cs.method}>
                      <input
                        type="radio"
                        name="shipping_option"
                        value={o.id}
                        checked={option === o.id}
                        onChange={() => setOption(o.id as ShippingId)}
                      />
                      <span>
                        <span className={cs.methodName}>{o.name}</span>
                        <span className={cs.methodDate}>Arrives by {formatDay(o.estimated_delivery)}</span>
                      </span>
                      <span className={cs.methodPrice}>{o.price_cents === 0 ? "Free" : money(o.price_cents)}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className={s.muted}>{quoteFailed ? "Shipping options couldn't load. Refresh the page to try again." : "Loading shipping options…"}</p>
              )}
            </fieldset>
          </form>
        </div>

        <aside className={cs.summary} aria-labelledby={`${uid}-summary`}>
          <h2 id={`${uid}-summary`} className={cs.summaryTitle}>
            Order summary
          </h2>
          {quote ? (
            <dl className={cs.totals} aria-busy={stale}>
              <div className={cs.totalRow}>
                <dt>
                  Subtotal ({itemCount} {itemCount === 1 ? "item" : "items"})
                </dt>
                <dd>{money(subtotal)}</dd>
              </div>
              {quote.discount_cents > 0 ? (
                <div className={cs.totalRow}>
                  <dt>Discount</dt>
                  <dd>−{money(quote.discount_cents)}</dd>
                </div>
              ) : null}
              <div className={cs.totalRow}>
                <dt>Shipping{selected ? ` (${selected.name})` : ""}</dt>
                <dd className={stale ? cs.pending : undefined}>
                  {stale ? "Updating…" : quote.shipping_cents === 0 ? "Free" : money(quote.shipping_cents)}
                </dd>
              </div>
              <div className={cs.totalRow}>
                <dt>Tax{stateName ? ` (${stateName})` : ""}</dt>
                <dd className={quote.tax_pending || stale ? cs.pending : undefined}>
                  {stale ? "Updating…" : quote.tax_pending ? "Calculated from your state" : money(quote.tax_cents)}
                </dd>
              </div>
              <div className={`${cs.totalRow} ${cs.grand}`}>
                <dt>{quote.tax_pending && !stale ? "Total before tax" : "Total"}</dt>
                <dd className={stale ? cs.pending : undefined}>{stale ? "Updating…" : money(quote.total_cents)}</dd>
              </div>
            </dl>
          ) : (
            <p className={s.muted}>{quoteFailed ? "Totals couldn't load. Refresh the page to try again." : "Calculating totals…"}</p>
          )}

          {quote && quoteFailed ? <p className={cs.freeHint}>Totals couldn&apos;t update. Refresh the page to try again.</p> : null}

          {quote && !stale && quote.subtotal_cents < quote.free_shipping_from_cents ? (
            <p className={cs.freeHint}>
              Add {money(quote.free_shipping_from_cents - quote.subtotal_cents)} more for free standard shipping.
            </p>
          ) : null}

          {generalIssues.length ? (
            <ul className={cs.issues}>
              {generalIssues.map((i) => (
                <li key={i.code + i.message} className={s.noticeError}>
                  {i.message}
                </li>
              ))}
            </ul>
          ) : null}

          <button type="submit" form={`${uid}-checkout`} className={cs.paypal} disabled={busy || !quote || stale || blocked || done}>
            {busy ? "Starting checkout…" : "Checkout with PayPal"}
          </button>
          {blocked ? <p className={cs.payNote}>Fix the items marked in your cart to check out.</p> : null}
          <p className={cs.payNote}>
            You approve the payment in PayPal. PayPal holds it, and {shopName} is paid when your order ships.
          </p>

          <div className={cs.result}>
            {result?.status === "redirect" ? (
              <p className={s.notice} role="status">
                Taking you to PayPal…
              </p>
            ) : null}
            {result?.status === "bench" ? (
              <div className={s.notice} role="status">
                <p className={s.noticeTitle}>{result.message}</p>
                <p>Total {money(result.total_cents)}</p>
              </div>
            ) : null}
            {result?.status === "not_configured" ? (
              <div className={s.noticeError} role="alert">
                <p className={s.noticeTitle}>Payments are not configured</p>
                <p>{result.message}</p>
              </div>
            ) : null}
            {result?.status === "invalid" ? (
              <div className={s.noticeError} role="alert">
                <p className={s.noticeTitle}>{result.message}</p>
                {result.issues.length ? (
                  <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                    {result.issues.map((i) => (
                      <li key={i.code + i.message}>{i.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {result?.status === "error" ? (
              <div className={s.noticeError} role="alert">
                <p className={s.noticeTitle}>Checkout didn&apos;t start</p>
                <p>{result.message}</p>
              </div>
            ) : null}
          </div>
          <p className={s.srOnly} role="status" aria-live="polite">
            {announcement}
          </p>
        </aside>
      </div>
    </>
  );
}
