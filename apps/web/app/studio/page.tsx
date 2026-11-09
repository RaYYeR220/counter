import type { Metadata } from "next";
import { Suspense } from "react";
import { getShop, listVariants, type Shop, type Variant } from "@counter/db";
import { AppShell } from "@/components/app-shell/AppShell";
import { StudioView, StudioSkeleton, StudioUnavailable } from "@/components/studio/StudioView";
import { baseUrl, db, paypalConfigured } from "@/lib/server/runtime";

export const metadata: Metadata = {
  title: "Studio | Counter",
  description: "Set up a shop for AI shopping agents: connect PayPal, import products with suggested negotiation floors, publish, and copy the shop's agent endpoints.",
  robots: { index: false },
};

// Imports read a product page, call a model and search the market.
export const maxDuration = 60;

const DEFAULT_SHOP = "juniper-clay";
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ONBOARDING = new Set(["active", "pending", "declined"]);

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function StudioPage({ searchParams }: { searchParams: PageProps<"/studio">["searchParams"] }) {
  const params = await searchParams;
  const raw = first(params.shop)?.trim();
  const slug = raw && SLUG.test(raw) ? raw : DEFAULT_SHOP;
  const onboardingRaw = first(params.onboarding);
  const onboarding = onboardingRaw && ONBOARDING.has(onboardingRaw) ? (onboardingRaw as "active" | "pending" | "declined") : null;

  let shop: Shop | null;
  let variants: Variant[];
  try {
    shop = await getShop(db(), slug);
    variants = shop ? await listVariants(db(), slug) : [];
  } catch (err) {
    console.error("studio.page", err);
    return (
      <AppShell current="studio" shop={slug}>
        <StudioUnavailable slug={slug} reason="database" />
      </AppShell>
    );
  }
  if (!shop) {
    return (
      <AppShell current="studio">
        <StudioUnavailable slug={slug} reason="missing" />
      </AppShell>
    );
  }
  return (
    <AppShell current="studio" shop={shop.slug}>
      <StudioView
        shop={shop}
        variants={variants}
        base={baseUrl()}
        paymentsConnected={paypalConfigured()}
        onboarding={onboarding}
        created={first(params.created) === "1"}
      />
    </AppShell>
  );
}

/** `/studio?shop=<slug>`: set a shop up for agents, one page, every step visible. */
export default function Page(props: PageProps<"/studio">) {
  return (
    <Suspense
      fallback={
        <AppShell current="studio">
          <StudioSkeleton />
        </AppShell>
      }
    >
      <StudioPage searchParams={props.searchParams} />
    </Suspense>
  );
}
