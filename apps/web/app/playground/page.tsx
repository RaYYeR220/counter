import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Playground } from "@/components/playground/Playground";
import type { PlaygroundConfig } from "@/components/playground/types";
import { baseUrl, paypalConfigured } from "@/lib/server/runtime";

export const metadata: Metadata = {
  title: "Playground | Counter",
  description:
    "Chat with a buyer agent that shops three small shops through Counter: catalog search, a seller agent that negotiates inside the shop's floors, a Store Sync cart and PayPal checkout, every call shown as it happens.",
};

/**
 * Request-time settings: whether PayPal is connected, the sandbox buyer
 * login visitors approve payments with, and this deployment's MCP URL.
 */
async function PlaygroundWithConfig() {
  await connection();
  const email = process.env.PLAYGROUND_BUYER_EMAIL?.trim();
  const password = process.env.PLAYGROUND_BUYER_PASSWORD?.trim();
  const config: PlaygroundConfig = {
    paymentsConnected: paypalConfigured(),
    buyer: email && password ? { email, password } : null,
    mcpUrl: `${baseUrl()}/mcp`,
  };
  return <Playground config={config} />;
}

/** `/playground`: shop the demo shops through a buyer agent, no sign-in needed. */
export default function PlaygroundPage() {
  return (
    <AppShell current="playground">
      <Suspense fallback={<Playground config={null} />}>
        <PlaygroundWithConfig />
      </Suspense>
    </AppShell>
  );
}
