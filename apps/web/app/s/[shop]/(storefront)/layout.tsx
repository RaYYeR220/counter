import { Alegreya, Bricolage_Grotesque, Instrument_Sans, Young_Serif } from "next/font/google";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { BENCH_COOKIE, benchRunId } from "@/lib/storefront/bench";
import s from "@/components/storefront/sf.module.css";

const body = Instrument_Sans({ subsets: ["latin"], variable: "--font-sf-body", display: "swap" });
// One display face per shop; only the face a page uses is downloaded.
const young = Young_Serif({ weight: "400", subsets: ["latin"], variable: "--font-sf-young", display: "swap", preload: false });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-sf-bricolage", display: "swap", preload: false });
const alegreya = Alegreya({ subsets: ["latin"], variable: "--font-sf-alegreya", display: "swap", preload: false });

/**
 * Loads the page bridge that exposes Counter's shopping tools to in-page
 * agents (WebMCP). Left out of benchmark runs, so the storefront arm sees
 * only the shop's ordinary pages.
 */
async function WebMcpBridge() {
  const jar = await cookies();
  if (benchRunId(jar.get(BENCH_COOKIE)?.value)) return null;
  return <script src="/mcp?webmcp-script" defer />;
}

export default function StorefrontLayout({ children }: LayoutProps<"/s/[shop]">) {
  return (
    <div className={`${s.scope} ${body.variable} ${young.variable} ${bricolage.variable} ${alegreya.variable}`}>
      {children}
      <Suspense fallback={null}>
        <WebMcpBridge />
      </Suspense>
    </div>
  );
}
