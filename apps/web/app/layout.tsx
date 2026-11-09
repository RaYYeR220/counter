import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import { PUBLIC_ORIGIN } from "@/lib/site";
import "./globals.css";

// General Sans (Indian Type Foundry, Fontshare free licence), self-hosted.
const generalSans = localFont({
  src: [
    { path: "./fonts/GeneralSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/GeneralSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/GeneralSans-Semibold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-general-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_ORIGIN),
  title: "Counter: any small shop, buyable by any AI agent",
  description:
    "Counter puts a small PayPal shop on PayPal's Store Sync Cart API, so an AI agent can ask for one exact variant and get a straight answer. PayPal holds the payment until the shop ships.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${generalSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
