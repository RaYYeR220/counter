import Link from "next/link";
import type { ReactNode } from "react";
import "@/lib/app-theme/tokens.css";
import { THEME_BOOT_SCRIPT } from "@/lib/app-theme/theme";
import { CounterMark } from "@/components/brand/CounterMark";
import { ThemeToggle } from "./ThemeToggle";
import s from "./shell.module.css";

export type AppSurface = "playground" | "studio" | "console" | "docs";

const DEFAULT_SHOP = "juniper-clay";

/**
 * The frame shared by Counter's app surfaces: one header with the product
 * tabs, the theme switch, and the token scope every child draws from.
 */
export function AppShell({
  current,
  shop = DEFAULT_SHOP,
  tools,
  children,
}: {
  current: AppSurface;
  /** Shop the Studio and Console tabs open. */
  shop?: string;
  /** Extra controls at the right of the header. */
  tools?: ReactNode;
  children: ReactNode;
}) {
  const q = `?shop=${encodeURIComponent(shop)}`;
  const tabs: Array<{ id: AppSurface; label: string; href: string }> = [
    { id: "playground", label: "Playground", href: "/playground" },
    { id: "studio", label: "Studio", href: `/studio${q}` },
    { id: "console", label: "Console", href: `/console${q}` },
  ];
  return (
    <div className={`app-theme ${s.root}`} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <a className={s.skip} href="#main">
        Skip to content
      </a>
      <header className={s.bar}>
        <Link href="/" className={s.brand}>
          <span className={s.mark}>
            <CounterMark />
          </span>
          <span className={s.word}>Counter</span>
        </Link>
        <nav className={s.tabs} aria-label="Counter apps">
          {tabs.map((t) => (
            <Link key={t.id} href={t.href} className={s.tab} aria-current={t.id === current ? "page" : undefined} prefetch={false}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className={s.tools}>
          {tools}
          <ThemeToggle />
        </div>
      </header>
      <div id="main" className={s.main}>
        {children}
      </div>
    </div>
  );
}
