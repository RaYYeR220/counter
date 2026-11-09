import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import cs from "@/components/storefront/cart.module.css";
import c from "@/components/storefront/catalog.module.css";
import { ClearCart } from "@/components/storefront/ClearCart";
import { LoadingShell, ShopFrame } from "@/components/storefront/ShopFrame";
import s from "@/components/storefront/sf.module.css";
import { getShopSummary, shippingRates } from "@/lib/storefront/catalog";
import { formatDate, formatDay, money, STATE_NAMES } from "@/lib/storefront/format";
import { getOrderView, type OrderView } from "@/lib/storefront/orders";
import { productHref } from "@/lib/storefront/pick";

type Props = PageProps<"/s/[shop]/orders/[orderId]">;

const STATUS: Record<OrderView["status"], { label: string; text: string }> = {
  authorized: { label: "Payment held", text: "Payment held by PayPal; charged when it ships." },
  captured: { label: "Shipped", text: "Your order has shipped, and the payment was charged when it did." },
  voided: { label: "Cancelled", text: "This order was cancelled and PayPal released the hold. You were not charged." },
  refunded: { label: "Refunded", text: "This order was refunded to your PayPal account." },
  disputed: { label: "In dispute", text: "There is an open PayPal dispute on this order. PayPal will contact you about it." },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shop, orderId } = await params;
  const summary = await getShopSummary(shop);
  return { title: summary ? `Order ${orderId} | ${summary.name}` : `Order ${orderId}`, robots: { index: false } };
}

export default function OrderPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<LoadingShell label="Loading your order" />}>
      <Order params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Order({ params, searchParams }: Props) {
  const [{ shop: slug, orderId }, query] = await Promise.all([params, searchParams]);
  const shop = await getShopSummary(slug);
  if (!shop) notFound();
  const rates = shippingRates();
  const order = await getOrderView(shop.slug, orderId);

  if (!order) {
    return (
      <ShopFrame shop={shop} rates={rates}>
        <div className={c.missing}>
          <h1 className={s.pageTitle}>We can&apos;t find order {orderId}</h1>
          <p className={s.muted}>Check the order number in your confirmation and try the link again.</p>
          <p>
            <Link href={`/s/${shop.slug}`} className={s.link}>
              Back to {shop.name}
            </Link>
          </p>
        </div>
      </ShopFrame>
    );
  }

  const placed = query.placed === "1";
  const status = STATUS[order.status];
  const count = order.lines.reduce((n, l) => n + l.quantity, 0);
  const shipped = order.status === "captured" || Boolean(order.tracking);

  return (
    <ShopFrame shop={shop} rates={rates}>
      {placed ? <ClearCart shop={shop.slug} /> : null}
      <div className={cs.orderHead}>
        {placed ? <p className={s.muted}>Thank you, your order is in.</p> : null}
        <h1 className={s.pageTitle}>Order {order.id}</h1>
        <p className={cs.status}>
          <span className={cs.statusDot} aria-hidden="true" />
          {status.label}
        </p>
        <p>{status.text}</p>
      </div>

      <div className={cs.layout}>
        <div>
          <h2 className={s.srOnly}>Items</h2>
          <ul className={cs.lines}>
            {order.lines.map((l) => (
              <li key={l.variantId} className={cs.line} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                <div>
                  <h3 className={cs.lineName}>
                    {l.parentId ? <Link href={productHref(shop.slug, l.parentId, l.variantId)}>{l.name}</Link> : l.name}
                  </h3>
                  <p className={cs.lineMeta}>
                    {l.quantity} × {money(l.unitCents)}
                  </p>
                </div>
                <span className={cs.lineTotal}>{money(l.lineCents)}</span>
              </li>
            ))}
          </ul>

          <dl className={cs.facts}>
            <div className={cs.fact}>
              <dt>Placed</dt>
              <dd>{formatDate(order.placedAt)}</dd>
            </div>
            {order.shipTo ? (
              <div className={cs.fact}>
                <dt>Shipping to</dt>
                <dd>
                  {order.shipTo.city}, {STATE_NAMES[order.shipTo.state] ?? order.shipTo.state}
                </dd>
              </div>
            ) : null}
            {order.shippingOption ? (
              <div className={cs.fact}>
                <dt>Delivery</dt>
                <dd>
                  {order.shippingOption.name}
                  {!shipped && order.shippingOption.estimatedDelivery
                    ? `, estimated to arrive by ${formatDay(order.shippingOption.estimatedDelivery)}`
                    : ""}
                </dd>
              </div>
            ) : null}
            <div className={cs.fact}>
              <dt>Tracking</dt>
              <dd>
                {order.tracking ? (
                  <>
                    {order.tracking.carrier} {order.tracking.trackingNumber}
                    {order.tracking.url ? (
                      <>
                        {" "}
                        <a href={order.tracking.url} className={s.link} rel="noreferrer" target="_blank">
                          Track package
                        </a>
                      </>
                    ) : null}
                    {order.tracking.shippedAt ? `, shipped ${formatDate(order.tracking.shippedAt)}` : ""}
                  </>
                ) : (
                  "Added when your order ships"
                )}
              </dd>
            </div>
          </dl>
        </div>

        <aside className={cs.summary} aria-labelledby="order-summary">
          <h2 id="order-summary" className={cs.summaryTitle}>
            Payment
          </h2>
          <dl className={cs.totals}>
            {order.subtotalCents !== null ? (
              <div className={cs.totalRow}>
                <dt>
                  Subtotal ({count} {count === 1 ? "item" : "items"})
                </dt>
                <dd>{money(order.subtotalCents)}</dd>
              </div>
            ) : null}
            {order.discountCents > 0 ? (
              <div className={cs.totalRow}>
                <dt>Discount</dt>
                <dd>−{money(order.discountCents)}</dd>
              </div>
            ) : null}
            {order.shippingCents !== null ? (
              <div className={cs.totalRow}>
                <dt>Shipping</dt>
                <dd>{order.shippingCents === 0 ? "Free" : money(order.shippingCents)}</dd>
              </div>
            ) : null}
            {order.taxCents !== null ? (
              <div className={cs.totalRow}>
                <dt>Tax</dt>
                <dd>{money(order.taxCents)}</dd>
              </div>
            ) : null}
            <div className={`${cs.totalRow} ${cs.grand}`}>
              <dt>Total</dt>
              <dd>{money(order.totalCents)}</dd>
            </div>
          </dl>
          <p className={cs.payNote}>Paid with PayPal.</p>
          <p className={cs.payNote}>
            Returns are accepted within {shop.policy.returnsDays} days of delivery.{" "}
            <Link href={`/s/${shop.slug}`} className={s.link}>
              Back to {shop.name}
            </Link>
          </p>
        </aside>
      </div>
    </ShopFrame>
  );
}
