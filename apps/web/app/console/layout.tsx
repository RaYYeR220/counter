import type { Metadata } from "next";

// The Console's typeface comes from the root layout (Geist, as --font-geist-sans) through the
// --cx-font token in lib/console/theme.ts.

export const metadata: Metadata = {
  title: "Console | Counter",
  description: "What AI shopping agents are doing at your shop: traffic, negotiations against your floors, orders to ship and market prices.",
  robots: { index: false },
};

export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return children;
}
