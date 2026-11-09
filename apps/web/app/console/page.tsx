import { Suspense } from "react";
import { ConsoleLoader } from "@/components/console/ConsoleLoader";
import { consoleAiModels, modelLabel } from "@/lib/console/ai-config";

const DEFAULT_SHOP = "juniper-clay";

async function Console({ searchParams }: { searchParams: PageProps<"/console">["searchParams"] }) {
  const params = await searchParams;
  const raw = Array.isArray(params.shop) ? params.shop[0] : params.shop;
  const shop = raw && /^[a-z0-9][a-z0-9-]{0,79}$/.test(raw) ? raw : DEFAULT_SHOP;
  // The model ids only; the key stays on the server behind /api/console/ai.
  const aiModels = process.env.VENICE_API_KEY ? consoleAiModels().map((id) => ({ id, label: modelLabel(id) })) : [];
  return <ConsoleLoader shop={shop} aiModels={aiModels} licenseKey={process.env.AG_STUDIO_LICENSE || undefined} />;
}

/** The merchant Console: `/console?shop=<slug>`, Juniper Clay by default. */
export default function ConsolePage(props: PageProps<"/console">) {
  return (
    <Suspense fallback={null}>
      <Console searchParams={props.searchParams} />
    </Suspense>
  );
}
