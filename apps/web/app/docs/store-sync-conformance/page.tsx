import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { AppShell } from "@/components/app-shell/AppShell";
import { Markdown } from "@/components/app-shell/Markdown";
import s from "@/components/app-shell/docs.module.css";

export const metadata: Metadata = {
  title: "Store Sync conformance | Counter",
  description:
    "How Counter's merchant Cart API is checked against PayPal's Store Sync Postman collection and schema, the three assertions that contradict the schema, and the spec details Counter settles.",
};

/** The report lives at docs/store-sync-conformance.md in the repo root; it is read once, at build time. */
async function report(): Promise<string> {
  "use cache";
  cacheLife("max");
  return readFile(path.join(process.cwd(), "..", "..", "docs", "store-sync-conformance.md"), "utf8");
}

export default async function StoreSyncConformancePage() {
  const source = await report();
  return (
    <AppShell current="docs">
      <article className={s.doc}>
        <Markdown source={source} />
        <p className={s.source}>
          Source: <code>docs/store-sync-conformance.md</code> in the Counter repository.
        </p>
      </article>
    </AppShell>
  );
}
