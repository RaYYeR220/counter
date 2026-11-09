import Link from "next/link";
import { LINKS, MCP_CONFIG, PUBLIC_ORIGIN } from "@/lib/site";
import { floorExample, hero, mcpSurface } from "../data";
import l from "../landing.module.css";
import { CopyConfig } from "./CopyConfig";
import { FloorLadder } from "./FloorLadder";
import s from "./duo.module.css";

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const SOURCES = ["Perplexity", "Copilot", "Meta AI", "Counter MCP"];

export function AgentsAndShops() {
  const f = floorExample;
  return (
    <section aria-label="For agents and for shops">
      <div className={l.wrap}>
        <div className={s.duo}>
          <div className={s.col} id="agents">
            <p className={s.who}>
              <i aria-hidden />
              For agents
            </p>
            <h2 className={l.h2}>Connect once. Every Counter shop answers.</h2>
            <p className={`${l.lede} ${s.lede}`}>
              Add Counter as a remote MCP server. No key, no account. Then ask for two 12 oz speckled mugs in sage from {hero.shop}.
            </p>
            <div className={s.cfg}>
              <div className={s.cfgBar}>
                <code>MCP client config</code>
                <CopyConfig text={JSON.stringify(MCP_CONFIG)} />
              </div>
              <pre>
                <code>
                  {"{\n  "}
                  <span className={s.k}>&quot;mcpServers&quot;</span>
                  {": {\n    "}
                  <span className={s.k}>&quot;counter&quot;</span>
                  {": {\n      "}
                  <span className={s.k}>&quot;url&quot;</span>
                  {": "}
                  <span className={s.s}>&quot;{`${PUBLIC_ORIGIN}${LINKS.mcp}`}&quot;</span>
                  {"\n    }\n  }\n}"}
                </code>
              </pre>
            </div>
            <div className={s.rows}>
              <div className={s.row}>
                <h3>MCP</h3>
                <div>
                  <p>
                    {NUMBER_WORDS[mcpSurface.tools.length] ?? mcpSurface.tools.length} tools, from finding a shop to checking an order. Revision 2026-07-28, with a fallback to
                    2025-11-25 for clients that open with initialize.
                  </p>
                  <div className={s.det}>
                    {mcpSurface.tools.map((t) => (
                      <code key={t}>{t}</code>
                    ))}
                  </div>
                </div>
              </div>
              <div className={s.row}>
                <h3>WebMCP</h3>
                <div>
                  <p>Storefront pages offer the same tools to agents running inside the page.</p>
                  <div className={s.det}>
                    <code>/mcp?webmcp-script</code>
                  </div>
                </div>
              </div>
              <div className={s.row}>
                <h3>MCP Apps</h3>
                <div>
                  <p>Product, cart and approval cards for chat hosts that render them. Hosts that don&rsquo;t get the same text and structured output.</p>
                  <div className={s.det}>
                    {mcpSurface.cards.map((c) => (
                      <code key={c}>{c}</code>
                    ))}
                  </div>
                  <p className={s.note}>Tried in a stand-in host so far, not yet in a production chat client.</p>
                </div>
              </div>
            </div>
            <div className={s.links}>
              <Link className={`${l.btn} ${l.primary}`} href={LINKS.playground}>
                Try the playground
              </Link>
              <Link className={`${l.btn} ${l.ghost}`} href={LINKS.storefront}>
                Visit {hero.shop}
              </Link>
            </div>
          </div>

          <div className={s.col} id="shops">
            <p className={s.who}>
              <i aria-hidden data-ring="true" />
              For shops
            </p>
            <h2 className={l.h2}>Bring the catalog. Set the floor. Ship.</h2>
            <p className={`${l.lede} ${s.lede}`}>
              Counter gives a small shop the merchant Cart API that PayPal&rsquo;s agentic commerce platform calls. {hero.shipper} keeps running {hero.shop}
              ; Counter answers the agents.
            </p>
            <div className={s.rows}>
              <div className={s.row}>
                <h3>Studio</h3>
                <div>
                  <p>
                    Import products from a URL, a photo or a CSV. Options and prices come across as they are. Channel3 checks the market and suggests a
                    floor at 90% of the market low. Nothing goes live until you review it.
                  </p>
                </div>
              </div>
              <div className={s.row}>
                <h3>Floors</h3>
                <div>
                  <p>A floor per variant, a discount cap and a bundle size. The pricing engine enforces them in code, whatever the seller agent writes.</p>
                  <FloorLadder />
                  <p className={s.note}>
                    {hero.shop}&rsquo;s {f.name.toLowerCase()}. Cap {f.capPct}%, bundles from {f.bundleMin} items, {f.smallCartPct}% off when the cart
                    isn&rsquo;t a bundle.
                  </p>
                </div>
              </div>
              <div className={s.row}>
                <h3>Console</h3>
                <div>
                  <p>
                    See which agent opened each cart, ship and capture, refund, and answer disputes. Built on AG Studio, with an assistant that prepares a
                    shipment and leaves Confirm to you.
                  </p>
                  <div className={s.det}>
                    {SOURCES.map((x) => (
                      <code key={x}>{x}</code>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className={s.links}>
              <Link className={`${l.btn} ${l.primary}`} href={LINKS.studio}>
                Open Studio
              </Link>
              <Link className={`${l.btn} ${l.ghost}`} href={LINKS.console}>
                Open the Console
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
