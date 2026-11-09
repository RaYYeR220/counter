import Link from "next/link";
import type { Shop, Variant } from "@counter/db";
import { CopyField } from "@/components/app-shell/CopyField";
import { ConnectPayPalButton, CreateTestShop } from "./Forms";
import { Workbench } from "./Workbench";
import s from "./studio.module.css";

const DEMO_SHOPS = [
  { slug: "juniper-clay", name: "Juniper Clay" },
  { slug: "northpaw-roasters", name: "Northpaw Roasters" },
  { slug: "loop-and-lantern", name: "Loop & Lantern" },
];

type Tone = "ok" | "warn" | "bad" | "muted";

function connectState(shop: Shop, demo: boolean): { label: string; tone: Tone } {
  switch (shop.onboardingStatus) {
    case "active":
      return { label: "Connected", tone: "ok" };
    case "pending":
      return { label: "Waiting on PayPal", tone: "warn" };
    case "revoked":
      return { label: "Disconnected", tone: "bad" };
    default:
      return demo ? { label: "Pre-connected", tone: "ok" } : { label: "Not connected", tone: "muted" };
  }
}

const ONBOARDING_BANNER: Record<"active" | "pending" | "declined", { tone: Tone; text: string }> = {
  active: { tone: "ok", text: "PayPal is connected. Agent orders at this shop are now paid to your PayPal account." },
  pending: { tone: "warn", text: "PayPal is still checking the account. Payments switch to it once PayPal confirms the email and payments." },
  declined: { tone: "bad", text: "PayPal permissions weren't granted, so the shop isn't connected. Start again when you're ready." },
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Studio for one shop: five setup steps on one page, each showing its current state. */
export function StudioView({
  shop,
  variants,
  base,
  paymentsConnected,
  onboarding,
  created,
}: {
  shop: Shop;
  variants: Variant[];
  base: string;
  paymentsConnected: boolean;
  onboarding: "active" | "pending" | "declined" | null;
  created: boolean;
}) {
  const demo = !shop.slug.startsWith("try-");
  const connect = connectState(shop, demo);
  const live = variants.filter((v) => v.active);
  const products = new Set(live.map((v) => v.parentId)).size;
  const n = shop.policy.negotiation;
  const discounts = live.filter((v) => v.priceCents > 0).map((v) => Math.max(0, (v.priceCents - v.floorCents) / v.priceCents));
  const atList = discounts.filter((d) => d < 0.005).length;
  const maxDiscountPct = n?.enabled ? Math.max(0, n.max_discount_pct) : 0;

  const storeSync = `${base}/s/${shop.slug}/paypal/v1`;
  const mcp = `${base}/mcp`;
  const storefront = `${base}/s/${shop.slug}`;

  const steps = [
    { id: "connect", title: "Connect PayPal", state: connect.label },
    { id: "products", title: "Add products", state: products ? `${products} live` : "No products yet" },
    { id: "publish", title: "Publish", state: demo ? "Test shops only" : "Ready for drafts" },
    { id: "policy", title: "Agent policy", state: n?.enabled ? `Up to ${n.max_discount_pct}% off` : "No negotiation" },
    { id: "live", title: "Go live", state: "Endpoints" },
  ];

  return (
    <div className={s.studio}>
      <div className={s.shopBar}>
        <div className={s.shopId}>
          <h1>{shop.name}</h1>
          <p>
            {shop.owner}, {shop.city.includes(",") ? shop.city : `${shop.city}, ${shop.state}`}
            <span className={s.kind} data-demo={demo}>
              {demo ? "Demo shop" : "Test shop"}
            </span>
          </p>
        </div>
        <div className={s.shopTools}>
          <details className={s.menu}>
            <summary>Switch shop</summary>
            <ul className={s.menuPanel}>
              {DEMO_SHOPS.map((d) => (
                <li key={d.slug}>
                  <Link href={`/studio?shop=${d.slug}`} aria-current={d.slug === shop.slug ? "page" : undefined}>
                    {d.name}
                  </Link>
                </li>
              ))}
              {!demo ? (
                <li>
                  <Link href={`/studio?shop=${shop.slug}`} aria-current="page">
                    {shop.name} <code>{shop.slug}</code>
                  </Link>
                </li>
              ) : null}
            </ul>
          </details>
          <CreateTestShop />
        </div>
      </div>

      {created ? (
        <p className={s.banner} data-tone="ok" role="status">
          Test shop created at <code>{shop.slug}</code>. Keep this page&apos;s address to come back to it. Import products below, then publish
          them.
        </p>
      ) : null}

      <div className={s.layout}>
        <nav className={s.index} aria-label="Setup steps">
          <ol>
            {steps.map((st, i) => (
              <li key={st.id}>
                <a href={`#${st.id}`}>
                  <span className={s.indexNo}>{i + 1}</span>
                  <span className={s.indexText}>
                    <span>{st.title}</span>
                    <span className={s.indexState}>{st.state}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className={s.sections}>
          <section id="connect" className={s.section} aria-labelledby="connect-h">
            <header className={s.sectionHead}>
              <span className={s.stepNo} aria-hidden>
                1
              </span>
              <div className={s.sectionTitle}>
                <h2 id="connect-h">Connect PayPal</h2>
                <p>Agent orders are paid with PayPal: checkout authorizes the payment and the shop captures it when it ships.</p>
              </div>
              <span className={s.chip} data-tone={connect.tone}>
                {connect.label}
              </span>
            </header>
            <div className={s.sectionBody}>
              {onboarding ? (
                <p className={s.banner} data-tone={ONBOARDING_BANNER[onboarding].tone} role="status">
                  {ONBOARDING_BANNER[onboarding].text}
                </p>
              ) : null}
              <dl className={s.facts}>
                <div>
                  <dt>Onboarding</dt>
                  <dd>
                    <code>{shop.onboardingStatus}</code>
                    {demo && shop.onboardingStatus === "not_started" ? (
                      <span className={s.quiet}> (no signup needed: demo shops sell through the platform account)</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>Paid to</dt>
                  <dd>
                    {shop.paypalMerchantId ? (
                      <>
                        PayPal merchant <code>{shop.paypalMerchantId}</code>
                      </>
                    ) : (
                      "The platform's PayPal sandbox account"
                    )}
                  </dd>
                </div>
              </dl>
              {demo ? (
                <button type="button" className={s.button} disabled>
                  Connect PayPal (demo shops are pre-connected)
                </button>
              ) : (
                <ConnectPayPalButton shop={shop.slug} paymentsConnected={paymentsConnected} status={shop.onboardingStatus} />
              )}
            </div>
          </section>

          <Workbench shop={{ slug: shop.slug, name: shop.name, canPublish: !demo, maxDiscountPct }} liveProducts={products} />

          <section id="policy" className={s.section} aria-labelledby="policy-h">
            <header className={s.sectionHead}>
              <span className={s.stepNo} aria-hidden>
                4
              </span>
              <div className={s.sectionTitle}>
                <h2 id="policy-h">Agent policy</h2>
                <p>What the shop&apos;s seller agent may agree to. The pricing engine enforces it in code; the model can&apos;t talk past it.</p>
              </div>
              <span className={s.chip} data-tone={n?.enabled ? "ok" : "muted"}>
                {n?.enabled ? "Negotiating" : "List prices only"}
              </span>
            </header>
            <div className={s.sectionBody}>
              <dl className={s.policyGrid}>
                <div>
                  <dt>Negotiation</dt>
                  <dd>{n?.enabled ? "On" : "Off"}</dd>
                </div>
                <div>
                  <dt>Largest discount</dt>
                  <dd>{n?.enabled ? `${n.max_discount_pct}% off list` : "None"}</dd>
                </div>
                <div>
                  <dt>Bundle deals</dt>
                  <dd>{n?.enabled ? `From ${n.bundle_min_items} items in one cart` : "None"}</dd>
                </div>
                <div>
                  <dt>Returns</dt>
                  <dd>{shop.policy.returns_days} days</dd>
                </div>
                <div>
                  <dt>Ships from</dt>
                  <dd>
                    {shop.policy.ships_from_state}, after {shop.policy.handling_days} handling day{shop.policy.handling_days === 1 ? "" : "s"}
                  </dd>
                </div>
              </dl>
              <div className={s.floorNote}>
                <span className={s.floorSwatch} aria-hidden />
                <p>
                  Floors live on each variant: the lowest unit price the seller agent may accept.{" "}
                  {discounts.length ? (
                    <>
                      Across {discounts.length} live variant{discounts.length === 1 ? "" : "s"}, floors sit {pct(Math.min(...discounts))} to{" "}
                      {pct(Math.max(...discounts))} under list
                      {atList ? `; ${atList} ${atList === 1 ? "is" : "are"} held at list price` : ""}. Buyer agents never see them.
                    </>
                  ) : (
                    "Publish products to set their floors."
                  )}
                </p>
              </div>
              <p className={s.quiet}>
                Change floors in the <Link href={`/console?shop=${shop.slug}`}>Console</Link>, on the Catalog page.
              </p>
            </div>
          </section>

          <section id="live" className={s.section} aria-labelledby="live-h">
            <header className={s.sectionHead}>
              <span className={s.stepNo} aria-hidden>
                5
              </span>
              <div className={s.sectionTitle}>
                <h2 id="live-h">Go live</h2>
                <p>Where agents reach this shop. PayPal&apos;s agentic commerce platform calls the Store Sync base URL; any MCP client can use the MCP URL.</p>
              </div>
              <span className={s.chip} data-tone={products ? "ok" : "muted"}>
                {products ? "Open to agents" : "Empty catalog"}
              </span>
            </header>
            <div className={s.sectionBody}>
              <div className={s.endpoints}>
                <CopyField label="Store Sync Cart API base URL" value={storeSync} />
                <CopyField label="MCP server URL (all shops)" value={mcp} />
                <CopyField label="Storefront" value={storefront} />
              </div>
              <dl className={s.facts}>
                <div>
                  <dt>WebMCP</dt>
                  <dd>
                    On: the <a href={storefront}>storefront</a> loads the shop tools for in-page agents (<code>/mcp?webmcp-script</code>).
                  </dd>
                </div>
                <div>
                  <dt>Payments</dt>
                  <dd>{paymentsConnected ? "PayPal sandbox, Orders v2 AUTHORIZE" : "PayPal isn't connected on this deployment yet"}</dd>
                </div>
              </dl>
              <Link href="/docs/store-sync-conformance" className={s.badge}>
                <svg className={s.badgeMark} viewBox="0 0 20 20" width="20" height="20" aria-hidden>
                  <path d="M5 2.5h7l3.5 3.5v11.5H5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M8 10.5l1.8 1.8L13 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>
                  <strong>Store Sync conformance</strong>
                  <span>PayPal&apos;s Cart API checks, replayed in Counter&apos;s tests. Read the report</span>
                </span>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function StudioSkeleton() {
  return (
    <div className={s.studio} aria-busy="true">
      <div className={s.shopBar}>
        <div className={s.shopId}>
          <h1 className={s.skeletonText}>Loading shop</h1>
          <p className={s.quiet}>Reading the shop&apos;s setup…</p>
        </div>
      </div>
    </div>
  );
}

export function StudioUnavailable({ slug, reason }: { slug: string; reason: "missing" | "database" }) {
  return (
    <div className={s.studio}>
      <div className={s.empty}>
        <h1>{reason === "missing" ? "No shop at this address" : "Studio can't reach the shop data"}</h1>
        <p>
          {reason === "missing" ? (
            <>
              There&apos;s no shop called <code>{slug}</code>. Open one of the demo shops or create a test shop.
            </>
          ) : (
            "The shop database didn't answer. Reload in a moment."
          )}
        </p>
        <ul>
          {DEMO_SHOPS.map((d) => (
            <li key={d.slug}>
              <Link href={`/studio?shop=${d.slug}`}>{d.name}</Link>
            </li>
          ))}
        </ul>
        {reason === "missing" ? <CreateTestShop open /> : null}
      </div>
    </div>
  );
}
