import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import cs from "@/components/storefront/cart.module.css";
import { ClearCart } from "@/components/storefront/ClearCart";
import { LoadingShell } from "@/components/storefront/ShopFrame";
import s from "@/components/storefront/sf.module.css";
import { BENCH_COOKIE, benchRunId, getBenchCheckout } from "@/lib/storefront/bench";
import { getShopSummary } from "@/lib/storefront/catalog";
import { formatDay, money, STATE_NAMES } from "@/lib/storefront/format";
import { themeStyle } from "@/lib/storefront/theme";

type Props = PageProps<"/s/[shop]/checkout/handoff">;

export const metadata: Metadata = { title: "Handed to PayPal", robots: { index: false } };

export default function HandoffPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<LoadingShell label="Finishing checkout" />}>
      <Handoff params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Stand-in for the PayPal payment page during a benchmark run: the checkout
 * has left the shop, so this page only confirms what was handed over.
 */
async function Handoff({ params, searchParams }: Props) {
  const [{ shop: slug }, query, jar] = await Promise.all([params, searchParams, cookies()]);
  const shop = await getShopSummary(slug);
  if (!shop) notFound();

  const runId = benchRunId(jar.get(BENCH_COOKIE)?.value);
  const ref = typeof query.ref === "string" && /^\d{1,15}$/.test(query.ref) ? Number(query.ref) : null;
  const capture = runId && ref !== null ? await getBenchCheckout(ref) : null;
  const mine = capture && capture.runId === runId && capture.shop === shop.slug ? capture : null;
  const summary = mine?.summary;
  const address = mine?.shipping_address;

  return (
    <div className={s.root} style={themeStyle(shop.slug)}>
      <header className={s.header}>
        <div className={`${s.wrap} ${s.headerInner}`}>
          <p className={s.brand}>{shop.name}</p>
        </div>
      </header>
      <main id="main" className={s.main}>
        <div className={s.wrap} style={{ maxWidth: 720 }}>
          {mine ? (
            <>
              <ClearCart shop={shop.slug} />
              <h1 className={s.pageTitle}>Your order was handed to PayPal for payment</h1>
              <p style={{ marginTop: 14 }}>PayPal takes the payment from here. Nothing else is needed in this shop.</p>

              {summary ? (
                <section className={cs.summary} style={{ marginTop: 28 }} aria-labelledby="handoff-summary">
                  <h2 id="handoff-summary" className={cs.summaryTitle}>
                    Order summary
                  </h2>
                  <ul className={cs.lines} style={{ marginBottom: 16 }}>
                    {summary.lines.map((l) => (
                      <li key={l.variant_id} className={cs.line} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                        <div>
                          <p className={cs.lineName}>{l.name}</p>
                          <p className={cs.lineMeta}>
                            {l.quantity} × {money(l.unit_cents)}
                          </p>
                        </div>
                        <span className={cs.lineTotal}>{money(l.line_cents)}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className={cs.totals}>
                    <div className={cs.totalRow}>
                      <dt>Subtotal</dt>
                      <dd>{money(summary.subtotal_cents)}</dd>
                    </div>
                    {summary.discount_cents > 0 ? (
                      <div className={cs.totalRow}>
                        <dt>Discount</dt>
                        <dd>−{money(summary.discount_cents)}</dd>
                      </div>
                    ) : null}
                    {summary.shipping ? (
                      <div className={cs.totalRow}>
                        <dt>
                          Shipping ({summary.shipping.name}, arrives by {formatDay(summary.shipping.estimated_delivery)})
                        </dt>
                        <dd>{summary.shipping.price_cents === 0 ? "Free" : money(summary.shipping.price_cents)}</dd>
                      </div>
                    ) : null}
                    <div className={cs.totalRow}>
                      <dt>Tax</dt>
                      <dd>{money(summary.tax_cents)}</dd>
                    </div>
                    <div className={`${cs.totalRow} ${cs.grand}`}>
                      <dt>Total</dt>
                      <dd>{money(summary.total_cents)}</dd>
                    </div>
                  </dl>
                  {address?.admin_area_2 && address.admin_area_1 ? (
                    <p className={cs.payNote}>
                      Shipping to {address.address_line_1 ? `${address.address_line_1}, ` : ""}
                      {address.admin_area_2}, {STATE_NAMES[address.admin_area_1] ?? address.admin_area_1} {address.postal_code ?? ""}
                    </p>
                  ) : null}
                </section>
              ) : mine.total ? (
                <p style={{ marginTop: 20 }}>Total ${mine.total}</p>
              ) : null}

              <p className={s.muted} style={{ marginTop: 24 }}>
                You can close this tab.
              </p>
            </>
          ) : (
            <>
              <h1 className={s.pageTitle}>This checkout isn&apos;t available</h1>
              <p className={s.muted} style={{ marginTop: 14 }}>
                The link has expired or belongs to another session.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
