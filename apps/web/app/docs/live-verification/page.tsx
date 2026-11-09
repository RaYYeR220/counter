import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { AppShell } from "@/components/app-shell/AppShell";
import { Markdown } from "@/components/app-shell/Markdown";
import s from "@/components/app-shell/docs.module.css";

export const metadata: Metadata = {
  title: "Live PayPal verification | Counter",
  description:
    "Orders placed by buyer agents through Counter on the PayPal sandbox: the carts, PayPal orders, authorizations, captures and voids, with their ids, and what has not been run live yet.",
};

/** The record lives at docs/live-verification.md in the repo root; it is read once, at build time. */
async function record(): Promise<string> {
  "use cache";
  cacheLife("max");
  return readFile(path.join(process.cwd(), "..", "..", "docs", "live-verification.md"), "utf8");
}

export default async function LiveVerificationPage() {
  const source = await record();
  return (
    <AppShell current="docs">
      <article className={s.doc}>
        <Markdown source={source} />
        <p className={s.source}>
          Source: <code>docs/live-verification.md</code> in the Counter repository.
        </p>
      </article>
    </AppShell>
  );
}
