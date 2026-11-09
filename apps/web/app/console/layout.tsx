import type { Metadata } from "next";

// The Console's typeface comes from the root layout (General Sans, as --font-general-sans) through
// the --cx-font token in lib/app-theme/tokens.css.

export const metadata: Metadata = {
  title: "Console | Counter",
  description: "What AI shopping agents are doing at your shop: traffic, negotiations against your floors, orders to ship and market prices.",
  robots: { index: false },
};

export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return children;
}
