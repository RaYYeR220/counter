"use client";

import { useActionState } from "react";
import { connectPayPal, createTestShop } from "@/app/studio/actions";
import type { ActionState } from "./types";
import s from "./studio.module.css";

/** "Create a test shop": an empty `try-…` shop to import and publish into. */
export function CreateTestShop({ open = false }: { open?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createTestShop, null);
  return (
    <details className={s.menu} open={open || undefined}>
      <summary>Create a test shop</summary>
      <form action={action} className={s.menuPanel} data-wide>
        <p className={s.quiet}>An empty shop of your own for trying imports and publishing. Agents can shop it like the demo shops.</p>
        <label className={s.field}>
          <span>Shop name</span>
          <input name="name" maxLength={60} placeholder="Test shop" autoComplete="off" />
        </label>
        <button type="submit" className={s.primary} disabled={pending}>
          {pending ? "Creating…" : "Create test shop"}
        </button>
        <p className={s.formError} aria-live="polite">
          {state && !state.ok ? state.message : ""}
        </p>
      </form>
    </details>
  );
}

/** Starts PayPal signup for a test shop through a server action. */
export function ConnectPayPalButton({ shop, paymentsConnected, status }: { shop: string; paymentsConnected: boolean; status: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(connectPayPal, null);
  const label = status === "active" ? "Reconnect PayPal" : status === "pending" ? "Finish PayPal signup" : "Connect PayPal";
  return (
    <form action={action} className={s.inline}>
      <input type="hidden" name="shop" value={shop} />
      <button type="submit" className={s.primary} disabled={pending || !paymentsConnected}>
        {pending ? "Opening PayPal…" : label}
      </button>
      {!paymentsConnected ? <p className={s.quiet}>Payments aren&apos;t connected on this deployment yet, so PayPal signup can&apos;t start.</p> : null}
      <p className={s.formError} aria-live="polite">
        {state && !state.ok ? state.message : ""}
      </p>
    </form>
  );
}
