import { Suspense } from "react";

type Query = Promise<Record<string, string | string[] | undefined>>;

async function Outcome({ searchParams }: { searchParams: Query }) {
  const q = await searchParams;
  const cancelled = q.cancelled === "1";
  const token = typeof q.token === "string" ? q.token : undefined;
  return (
    <>
      <h1 style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.02em", margin: 0 }}>
        {cancelled ? "Payment not approved" : "Approved. Your agent can finish the order."}
      </h1>
      <p style={{ opacity: 0.7, lineHeight: 1.5 }}>
        {cancelled
          ? "Nothing was charged. Tell your agent if you want to try again."
          : "PayPal is holding the payment. The shop is charged only when your order ships. You can close this tab and go back to your conversation."}
      </p>
      {token ? <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, opacity: 0.6 }}>PayPal order {token}</p> : null}
    </>
  );
}

export default function PayPalReturn({ searchParams }: { searchParams: Query }) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <Suspense fallback={<p style={{ opacity: 0.6 }}>Checking your payment…</p>}>
          <Outcome searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
