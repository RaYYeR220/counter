import Link from "next/link";
import { CounterMark } from "@/components/brand/CounterMark";
import { GITHUB_URL, LINKS } from "@/lib/site";
import { hero } from "./data";
import { glazeVar } from "./glaze";
import l from "./landing.module.css";

/** The shop's variants again, small and still, with the one the closing line asks for ringed. */
function ClusterEmblem({ picked }: { picked: string }) {
  const s = 20;
  const rows = [7, 8, 9, 8, 7];
  const pts: Array<{ x: number; y: number }> = [];
  rows.forEach((n, ri) => {
    for (let i = 0; i < n; i++) pts.push({ x: 88 + (i - (n - 1) / 2) * s, y: 40 + (ri - 2) * s * 0.87 });
  });
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  return (
    <svg className={l.emblem} viewBox="0 0 176 80" aria-hidden>
      {hero.variants.map((v, i) => {
        const p = pts[i];
        if (!p) return null;
        const r = v.stock ? s * (0.085 + 0.064 * Math.sqrt(v.stock)) : s * 0.12;
        const c = glazeVar(v.glaze);
        return (
          <g key={v.id}>
            {v.stock ? (
              <circle cx={p.x} cy={p.y} r={r} fill={c} stroke={v.glaze === "oat" ? "rgba(26,25,21,.2)" : "none"} strokeWidth=".8" />
            ) : (
              <circle cx={p.x} cy={p.y} r={r} fill="none" stroke={v.glaze === "oat" ? "rgba(26,25,21,.38)" : c} strokeWidth="1" />
            )}
            {v.id === picked ? <circle cx={p.x} cy={p.y} r={r + 3.5} fill="none" stroke="var(--cx-ring)" strokeWidth="1.2" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

export function Closing() {
  return (
    <section className={l.close} aria-labelledby="close-title">
      <div className={l.wrap}>
        <ClusterEmblem picked="JC-MUG-SPECKLE-SAGE-12" />
        <h2 id="close-title" className={l.h2}>
          Ask {hero.shop} for a mug.
        </h2>
        <p>
          Rosa and Theo throw, glaze and fire every piece in Portland. All {hero.variants.length} variants answer agents on Counter.
        </p>
        <div className={l.ctas}>
          <Link className={`${l.btn} ${l.primary}`} href={LINKS.playground}>
            Try the playground
          </Link>
          <Link className={`${l.btn} ${l.ghost}`} href={LINKS.storefront}>
            Visit the storefront
          </Link>
        </div>
      </div>
    </section>
  );
}

const FOOTER_LINKS = [
  { label: "Playground", href: LINKS.playground },
  { label: "Studio", href: LINKS.studio },
  { label: "Console", href: LINKS.console },
  { label: "Docs", href: LINKS.conformance },
  { label: "MCP server", href: LINKS.mcp },
  { label: "GitHub", href: GITHUB_URL },
];

export function Footer() {
  return (
    <footer className={l.foot}>
      <div className={l.wrap}>
        <div className={l.footIn}>
          <div>
            <a className={l.brand} href="#top" aria-label="Counter, back to top">
              <CounterMark />
              Counter
            </a>
            <p>Any small PayPal shop, buyable by any AI agent.</p>
          </div>
          <ul className={l.footLinks}>
            {FOOTER_LINKS.map((x) => (
              <li key={x.label}>
                <a href={x.href}>{x.label}</a>
              </li>
            ))}
          </ul>
        </div>
        <div className={l.footBase}>
          <span>Built on PayPal Store Sync · sandbox</span>
          <span>MIT licensed</span>
        </div>
      </div>
    </footer>
  );
}
