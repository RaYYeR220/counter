import Link from "next/link";
import type { ReactNode } from "react";
import { LINKS, TEST_COUNTS } from "@/lib/site";
import l from "../landing.module.css";
import s from "./paypal.module.css";

interface Api {
  name: string;
  role?: string;
  endpoints: string[];
  /** As docs/live-verification.md records it. */
  status: { live: boolean; label: string };
  body: ReactNode;
}

const APIS: Api[] = [
  {
    name: "Store Sync Cart API",
    role: "merchant side",
    endpoints: ["POST /merchant-cart", "GET /merchant-cart/{id}", "PUT /merchant-cart/{id}", "POST …/checkout"],
    status: { live: true, label: "Live on sandbox" },
    body: (
      <>
        Served for every shop at <code>/s/&lt;shop&gt;/paypal/v1</code>, every body parsed with PayPal&rsquo;s own schema package. A port of PayPal&rsquo;s
        Postman collection: {TEST_COUNTS.conformancePassed} checks pass, and the {TEST_COUNTS.conformanceExpectedFailures} that contradict the schema fail
        as expected.
      </>
    ),
  },
  {
    name: "Orders v2",
    role: "authorize",
    endpoints: ["intent: AUTHORIZE", "PATCH", "/authorize"],
    status: { live: true, label: "Live on sandbox" },
    body: <>One order per cart, kept in step with every cart edit, approved by the buyer in PayPal&rsquo;s checkout and authorized at Store Sync checkout.</>,
  },
  {
    name: "Payments v2",
    role: "capture, void, refund",
    endpoints: ["/capture", "/void", "/refund", "/track"],
    status: { live: true, label: "Live on sandbox" },
    body: (
      <>
        Captured when the shop ships, with the tracking number on the PayPal order; voided when the shop cancels, and the stock goes back; refunded in
        full or in part from the Console.
      </>
    ),
  },
  {
    name: "Webhooks",
    endpoints: ["verify-webhook-signature"],
    status: { live: true, label: "Live on sandbox" },
    body: <>Every delivery verified over the exact bytes and handled once per event id. Orders, disputes and onboarding update from them.</>,
  },
  {
    name: "Disputes v1",
    role: "evidence",
    endpoints: ["provide-evidence", "accept-claim"],
    status: { live: false, label: "Fixture-tested" },
    body: (
      <>
        Each dispute decided by rule from the order&rsquo;s record, answered with a generated evidence PDF.{" "}
        <em>Not yet run against a buyer-raised dispute.</em>
      </>
    ),
  },
  {
    name: "Partner Referrals v2",
    endpoints: ["PayPal-Auth-Assertion", "BN code"],
    status: { live: true, label: "Onboarding link live" },
    body: (
      <>
        A shop connects its own PayPal account from Studio, and Counter then acts on its behalf with a 2% platform fee.{" "}
        <em>A second seller&rsquo;s consent, and the payments that follow it, have not been run yet.</em>
      </>
    ),
  },
  {
    name: "Vault v3",
    endpoints: ["setup-tokens", "payment-tokens"],
    status: { live: true, label: "Setup tokens live" },
    body: (
      <>
        Setup tokens are issued on the sandbox. <em>No checkout flow uses a vaulted wallet yet.</em>
      </>
    ),
  },
];

export function PayPalUnderneath() {
  return (
    <section className={l.section} id="paypal" aria-labelledby="paypal-title">
      <div className={l.wrap}>
        <div className={l.sectionHead}>
          <h2 id="paypal-title" className={l.h2}>
            PayPal underneath, end to end.
          </h2>
          <p className={l.lede}>Counter adds no payment rail of its own. Every cart, authorization, capture, refund and dispute answer is a PayPal API call.</p>
        </div>
        <div className={s.apis}>
          {APIS.map((a) => (
            <div key={a.name} className={s.row}>
              <h3>
                {a.name}
                {a.role ? <small>{a.role}</small> : null}
                <span className={s.status} data-live={a.status.live}>
                  {a.status.label}
                </span>
              </h3>
              <div className={s.eps}>
                {a.endpoints.map((e) => (
                  <code key={e}>{e}</code>
                ))}
              </div>
              <p>{a.body}</p>
            </div>
          ))}
        </div>
        <div className={s.live}>
          <h3>
            <i aria-hidden />
            What&rsquo;s live
          </h3>
          <div>
            <p>
              On the PayPal sandbox, end to end: a buyer agent&rsquo;s cart goes through Counter&rsquo;s MCP server and the shop&rsquo;s Store Sync Cart
              API into a PayPal Orders v2 AUTHORIZE order; a sandbox buyer approves it in PayPal&rsquo;s checkout; checkout authorizes it; the payment is
              captured when the merchant ships, with tracking on the order, or voided when the merchant cancels, and a refund goes back through
              PayPal. PayPal&rsquo;s webhooks arrive and are signature-verified.
            </p>
            <p>
              Not yet live: a buyer-raised dispute answered with the evidence PDF, seller onboarding completed by a second business account, and
              PayPal&rsquo;s Postman collection run against the deployment.
              No shop here is onboarded to PayPal&rsquo;s agentic commerce platform yet; Counter&rsquo;s gateway signs requests the way that platform does.
              Sandbox money only.{" "}
              <Link className={l.link} href={LINKS.liveVerification}>
                Order, authorization and capture ids
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
