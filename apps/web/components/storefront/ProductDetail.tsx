"use client";

import Link from "next/link";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { addToCart } from "@/lib/storefront/cart-store";
import { attributeLabel, displayValue, formatDay, money, stockLabel } from "@/lib/storefront/format";
import { choose, findVariant, initialSelection, optionsFor, type Selection } from "@/lib/storefront/options";
import { artSubject } from "@/lib/storefront/pick";
import type { DeliveryQuote, ProductView, VariantView } from "@/lib/storefront/types";
import { artLabel, ProductArt, swatchColor } from "./ProductArt";
import p from "./product.module.css";
import s from "./sf.module.css";

function flagNotices(v: VariantView): Array<{ key: string; text: string; blocks: boolean }> {
  const out: Array<{ key: string; text: string; blocks: boolean }> = [];
  for (const flag of v.flags) {
    if (flag === "seconds") out.push({ key: flag, text: "Seconds — cosmetic flaws", blocks: false });
    else if (flag === "decaf") out.push({ key: flag, text: "Decaf", blocks: false });
    else if (flag === "limited") out.push({ key: flag, text: "Limited lot", blocks: false });
    else if (flag === "made_to_order") {
      out.push({ key: flag, text: `Made to order — ships in about ${v.leadTimeDays} days`, blocks: false });
    } else if (flag === "subscription_only") {
      out.push({ key: flag, text: "Subscription only — not sold individually", blocks: true });
    }
  }
  if (!v.purchasable && !v.flags.includes("subscription_only")) {
    out.push({ key: "not_purchasable", text: "Not sold individually", blocks: true });
  }
  if (!v.active) out.push({ key: "inactive", text: "No longer available", blocks: true });
  return out;
}

export function ProductDetail({
  shop,
  product,
  initialVariantId,
  quotes,
  freeFromCents,
  shipsFrom,
  handlingDays,
  children,
}: {
  shop: string;
  product: ProductView;
  initialVariantId: string | undefined;
  quotes: Record<number, DeliveryQuote[]>;
  freeFromCents: number;
  shipsFrom: string;
  handlingDays: number;
  children?: ReactNode;
}) {
  const uid = useId();
  const order = product.attributeOrder;
  const [selection, setSelection] = useState<Selection>(() => initialSelection(product, initialVariantId));
  const variant = findVariant(product, selection) ?? product.variants[0]!;
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState<ReactNode>(null);

  const notices = flagNotices(variant);
  const blocked = notices.find((n) => n.blocks);
  const inStock = variant.stock > 0;
  const canBuy = !blocked && inStock;
  const maxQty = Math.max(1, variant.stock);
  const quantity = Math.min(Math.max(1, qty), maxQty);
  const subject = artSubject(product, variant);
  const whyId = `${uid}-why`;

  function select(key: string, value: string) {
    const next = choose(product, selection, key, value);
    setSelection(next);
    setMessage(null);
    const v = findVariant(product, next);
    if (v) {
      const url = new URL(window.location.href);
      url.searchParams.set("v", v.variantId);
      window.history.replaceState(null, "", url);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canBuy) return;
    const { added, inCart } = addToCart(shop, variant.variantId, quantity, variant.stock);
    if (added === 0) {
      setMessage(
        <>
          All {variant.stock} in stock are already in your cart.{" "}
          <Link href={`/s/${shop}/cart`}>View cart</Link>
        </>,
      );
      return;
    }
    const capped = added < quantity ? ` Only ${variant.stock} are in stock, so your cart now has ${inCart}.` : "";
    setMessage(
      <>
        Added {added} × {variant.name} to your cart.{capped}{" "}
        <Link href={`/s/${shop}/cart`}>View cart</Link>
      </>,
    );
  }

  const deliveries = quotes[variant.leadTimeDays] ?? [];

  return (
    <div className={p.layout}>
      <div className={p.media}>
        <ProductArt subject={subject} label={artLabel(subject, order)} />
      </div>

      <div className={p.info}>
        <h1 className={p.title}>{product.name}</h1>
        <p className={p.price}>{money(variant.priceCents)}</p>

        {notices.length ? (
          <ul className={p.flags} aria-label="About this option">
            {notices.map((n) => (
              <li key={n.key} id={n === blocked ? whyId : undefined} className={n.blocks ? p.flagBlock : p.flag}>
                {n.text}
              </li>
            ))}
          </ul>
        ) : null}

        <form className={p.form} onSubmit={onSubmit} aria-label={`Buy ${product.name}`}>
          {order.map((key, level) => {
            const options = optionsFor(product, selection, level);
            const name = `${uid}-${key}`;
            return (
              <fieldset key={key} className={p.group}>
                <legend className={p.legend}>
                  <span className={p.legendName}>{attributeLabel(key)}</span>
                  <span className={p.legendValue}>: {displayValue(selection[key] ?? "")}</span>
                </legend>
                <div className={p.options}>
                  {options.map((o) => {
                    const swatch = swatchColor(key, o.value);
                    const disabled = o.soldOut || o.unavailable;
                    return (
                      <label key={o.value} className={p.option}>
                        <input
                          type="radio"
                          name={name}
                          value={o.value}
                          checked={selection[key] === o.value}
                          disabled={disabled}
                          onChange={() => select(key, o.value)}
                        />
                        {swatch ? <span className={p.swatch} style={{ background: swatch }} aria-hidden="true" /> : null}
                        <span className={disabled ? p.struck : undefined}>{displayValue(o.value)}</span>
                        {o.soldOut ? <span className={p.optionNote}>Sold out</span> : null}
                        {o.unavailable ? <span className={p.optionNote}>Unavailable</span> : null}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <p className={p.stock}>
            <span className={`${p.stockDot} ${inStock ? "" : p.stockOut}`} aria-hidden="true" />
            {stockLabel(variant.stock)}
          </p>

          <div className={p.buyRow}>
            <div>
              <label htmlFor={`${uid}-qty`} className={p.qtyLabel}>
                Quantity
              </label>
              <div className={p.stepper}>
                <button
                  type="button"
                  className={p.stepButton}
                  aria-label="Decrease quantity"
                  disabled={!canBuy || quantity <= 1}
                  onClick={() => setQty(quantity - 1)}
                >
                  −
                </button>
                <input
                  id={`${uid}-qty`}
                  className={p.qtyInput}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={maxQty}
                  step={1}
                  value={quantity}
                  disabled={!canBuy}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    setQty(Number.isFinite(n) ? n : 1);
                  }}
                />
                <button
                  type="button"
                  className={p.stepButton}
                  aria-label="Increase quantity"
                  disabled={!canBuy || quantity >= maxQty}
                  onClick={() => setQty(quantity + 1)}
                >
                  +
                </button>
              </div>
            </div>
            <button
              type="submit"
              className={`${s.button} ${p.addButton}`}
              disabled={!canBuy}
              aria-describedby={blocked ? whyId : undefined}
            >
              {blocked ? blocked.text.split(" — ")[0] : inStock ? "Add to cart" : "Sold out"}
            </button>
          </div>

          <div className={p.status} role="status" aria-live="polite">
            {message}
          </div>
        </form>

        {deliveries.length ? (
          <section className={p.section} aria-labelledby={`${uid}-delivery`}>
            <h2 id={`${uid}-delivery`} className={p.sectionTitle}>
              Delivery
            </h2>
            <table className={p.delivery}>
              <caption className={s.srOnly}>Delivery estimates for US addresses, ordering today</caption>
              <thead className={s.srOnly}>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Price</th>
                  <th scope="col">Estimated arrival</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">{d.name}</th>
                    <td>
                      {money(d.priceCents)}
                      {d.id === "STANDARD" ? (
                        <span className={p.deliveryNote}>Free on orders of {money(freeFromCents)} or more</span>
                      ) : null}
                    </td>
                    <td>Arrives by {formatDay(d.estimatedDelivery)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={p.small}>
              {variant.leadTimeDays > 0
                ? `Made after you order, then shipped from ${shipsFrom}. Dates are for orders placed today.`
                : `Ships from ${shipsFrom} within ${handlingDays} business ${handlingDays === 1 ? "day" : "days"}. Dates are for orders placed today.`}
            </p>
          </section>
        ) : null}

        {children}
      </div>
    </div>
  );
}
