import type { CSSProperties, ReactNode } from "react";
import { DEMO_SHOP } from "@/lib/site";
import { featuredExchange, sampleCart, searchExcerpt } from "../data";
import { glazeVar } from "../glaze";
import l from "../landing.module.css";
import { StepPath } from "./StepPath";
import s from "./how.module.css";

function Step({ n, title, aside, children, api, tool }: { n: number; title: string; aside?: string; children: ReactNode; api: string; tool: string }) {
  return (
    <div className={s.text}>
      <span className={s.n}>{n}</span>
      <h3>
        {title}
        {aside ? <small>{aside}</small> : null}
      </h3>
      {children}
      <p className={s.api}>
        {api}
        <code>{tool}</code>
      </p>
    </div>
  );
}

function ArtBar({ label, code }: { label: string; code: string }) {
  return (
    <div className={s.artBar}>
      <span>{label}</span>
      <code>{code}</code>
    </div>
  );
}

const K = ({ children }: { children: ReactNode }) => <span className={s.k}>{children}</span>;

export function HowItWorks() {
  const cart = sampleCart;
  const ex = featuredExchange;
  return (
    <section className={`${l.section} ${s.section}`} id="how" aria-labelledby="how-title">
      <div className={l.wrap}>
        <div className={l.sectionHead}>
          <h2 id="how-title" className={l.h2}>
            One exact cart, from the question to the parcel.
          </h2>
          <p className={l.lede}>
            The agent speaks MCP. The shop answers on its own Store Sync endpoints. The money moves through PayPal Orders v2 and is taken only when the
            shop ships.
          </p>
        </div>

        <StepPath className={s.path}>
          <li className={s.step} data-step>
            <Step n={1} title="Find" api="MCP tool" tool="search_products">
              <p>The agent searches the shop&rsquo;s variants. A sold-out variant is listed and marked, never hidden, so the agent tells the buyer instead of guessing.</p>
            </Step>
            <figure className={s.art}>
              <ArtBar label={`Juniper Clay, ${searchExcerpt.length} of its variants`} code={searchExcerpt[0]!.size} />
              <div className={s.artBody}>
                <div className={s.rs}>
                  {searchExcerpt.map((v) => (
                    <div key={v.id} className={s.rsRow}>
                      <i className={s.dot} data-empty={v.stock === 0} data-seconds={v.flag === "seconds"} style={{ "--g": glazeVar(v.glaze) } as CSSProperties} aria-hidden />
                      <span className={s.who}>
                        <span className={s.id}>{v.id}</span>
                        <span className={s.nm}>
                          {v.name}, {v.attrs}
                          {v.flag === "seconds" ? ", sold as a second" : ""}
                        </span>
                      </span>
                      <span className={s.pr}>${v.price}</span>
                      <span className={s.sk}>
                        {v.stock} in stock
                        {v.stock === 0 ? <span className={`${s.tag} ${s.tagRing}`}>Sold out, listed</span> : null}
                        {v.flag === "seconds" ? <span className={s.tag}>Second</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </figure>
          </li>

          <li className={s.step} data-step>
            <Step n={2} title="Haggle" aside="if the buyer asks" api="MCP tool" tool="negotiate">
              <p>
                The agent can ask the shop&rsquo;s seller agent for a deal. A pricing engine has the last word: never below the merchant&rsquo;s floor,
                never past the discount cap. Neither the agent nor the seller model ever sees the floor.
              </p>
            </Step>
            <figure className={s.art}>
              <ArtBar label={`Run ${ex.id} of the negotiation benchmark`} code={ex.model} />
              <div className={s.artBody}>
                <div className={s.convo}>
                  <div className={s.turn}>
                    <span className={s.turnWho}>Buyer agent</span>
                    <span className={`${s.say} ${s.inj}`}>{ex.buyer}</span>
                  </div>
                  <div className={s.turn}>
                    <span className={s.turnWho}>Seller agent</span>
                    <span className={s.say}>{ex.reply}</span>
                  </div>
                </div>
                <div className={s.verdict}>
                  <span>
                    Engine <b>{ex.verdict}</b>
                  </span>
                  <span>
                    <b>${ex.unit}</b> of ${ex.list} list
                  </span>
                  <span>Offer bound to this agent, these lines, 30 minutes</span>
                </div>
              </div>
            </figure>
          </li>

          <li className={s.step} data-step>
            <Step n={3} title="Open the cart" api="MCP tool" tool="create_cart">
              <p>
                The cart opens on the shop&rsquo;s own Store Sync endpoint with a token signed the way PayPal&rsquo;s platform signs it. The shop checks the
                body against PayPal&rsquo;s schema and prices tax, shipping and any offer.
              </p>
            </Step>
            <figure className={s.art}>
              <ArtBar label="Store Sync Cart API" code="@paypal/commerce-cart-zod 1.4.0" />
              <div className={s.artBody}>
                <pre className={s.code}>
                  <span className={s.m}>POST</span> /s/{DEMO_SHOP}/paypal/v1/merchant-cart{"\n"}
                  <K>Authorization:</K> Bearer eyJhbGciOiJSUzI1NiIs…{"\n"}
                  <span className={s.c}>{"  "}RS256, iss paypal.com, scope cart, Client_Identifier:Perplexity</span>
                  {"\n{\n  "}
                  <K>&quot;items&quot;:</K> [{"{ "}
                  <K>&quot;variant_id&quot;:</K> &quot;{cart.variantId}&quot;, <K>&quot;quantity&quot;:</K> {cart.quantity}
                  {" }],\n  "}
                  <K>&quot;shipping_address&quot;:</K> {"{ … }\n}"}
                </pre>
                <div className={s.gap} />
                <pre className={s.code}>
                  <span className={s.ok}>201 Created</span>
                  {"\n{\n  "}
                  <K>&quot;status&quot;:</K> &quot;CREATED&quot;,{"\n  "}
                  <K>&quot;validation_status&quot;:</K> &quot;VALID&quot;,{"\n  "}
                  <K>&quot;totals&quot;:</K> {"{\n    "}
                  <K>&quot;subtotal&quot;:</K> {"{ "}
                  <K>&quot;currency_code&quot;:</K> &quot;USD&quot;, <K>&quot;value&quot;:</K> &quot;{cart.subtotal}&quot;{" },\n    "}
                  <K>&quot;shipping&quot;:</K> {"{ … "}&quot;{cart.shipping}&quot;{" },  "}
                  <K>&quot;tax&quot;:</K> {"{ … "}&quot;{cart.tax}&quot;{" },\n    "}
                  <K>&quot;total&quot;:</K> {"{ "}
                  <K>&quot;currency_code&quot;:</K> &quot;USD&quot;, <K>&quot;value&quot;:</K> &quot;{cart.total}&quot;{" }\n  }\n}"}
                </pre>
              </div>
            </figure>
          </li>

          <li className={s.step} data-step>
            <Step n={4} title="Approve in PayPal" api="MCP tool" tool="checkout">
              <p>The buyer approves the payment in PayPal. Checkout then authorizes the order: the money is held, not taken.</p>
            </Step>
            <figure className={s.art}>
              <ArtBar label="PayPal Orders v2" code="intent: AUTHORIZE" />
              <div className={s.artBody}>
                <div className={s.chain} data-chain>
                  <span className={s.st} data-status>
                    CREATED
                  </span>
                  <i />
                  <span className={s.st} data-status>
                    APPROVED
                  </span>
                  <i />
                  <span className={s.st} data-status>
                    AUTHORIZED
                  </span>
                </div>
                <p className={s.note}>The buyer approves in PayPal; nothing is charged yet.</p>
                <div className={s.gap} />
                <pre className={s.code}>
                  <span className={s.m}>POST</span> /merchant-cart/{"{id}"}/checkout{"   "}
                  <span className={s.ok}>200</span>
                  {"\n{ "}
                  <K>&quot;status&quot;:</K> &quot;COMPLETED&quot;,{"\n  "}
                  <K>&quot;payment_confirmation&quot;:</K> {"{ "}
                  <K>&quot;merchant_order_number&quot;:</K> …, <K>&quot;order_review_page&quot;:</K> {"… } }"}
                </pre>
              </div>
            </figure>
          </li>

          <li className={s.step} data-step>
            <Step n={5} title="Ship, then capture" api="MCP tool" tool="order_status">
              <p>
                The shop ships from the Console and the authorization is captured, with the tracking number on the PayPal order. If the shop cancels
                instead, the authorization is voided and nothing was ever taken.
              </p>
            </Step>
            <figure className={s.art}>
              <ArtBar label="PayPal Payments v2" code="final_capture: true" />
              <div className={s.artBody}>
                <div className={s.chain} data-chain>
                  <span className={s.st} data-status>
                    AUTHORIZED
                  </span>
                  <i />
                  <span className={s.st} data-status>
                    CAPTURED
                  </span>
                </div>
                <p className={s.note}>
                  Cancelled instead: <span className={`${s.st} ${s.stSmall}`}>VOIDED</span>
                </p>
                <div className={s.gap} />
                <pre className={s.code}>
                  <span className={s.m}>POST</span> /v2/payments/authorizations/{"{id}"}/capture{"\n"}
                  <span className={s.m}>POST</span> /v2/checkout/orders/{"{id}"}/track{"   "}
                  <span className={s.c}>carrier, tracking number</span>
                </pre>
              </div>
            </figure>
          </li>

          <li className={s.step} data-step>
            <Step n={6} title="Dispute" aside="if it comes to that" api="PayPal Disputes" tool="provide-evidence">
              <p>Counter decides each dispute by rule from the order&rsquo;s record and answers it with a generated evidence PDF.</p>
            </Step>
            <figure className={s.art}>
              <ArtBar label="Evidence PDF" code="/v1/customer/disputes/{id}/provide-evidence" />
              <div className={s.artBody}>
                <ul className={s.pdf}>
                  <li>The order, line by line</li>
                  <li>The shipment and its tracking number</li>
                  <li>The agent&rsquo;s own request, in its own words</li>
                  <li>The negotiation, if there was one</li>
                </ul>
              </div>
            </figure>
          </li>
        </StepPath>
      </div>
    </section>
  );
}
