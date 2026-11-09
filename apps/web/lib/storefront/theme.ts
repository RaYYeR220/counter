import type { CSSProperties } from "react";

/**
 * Each shop's look: colors, the display face (a CSS variable set by the
 * storefront layout's fonts) and corner radii.
 */
export interface ShopTheme {
  bg: string;
  surface: string;
  tile: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  /** A second brand color for small marks (badges, rules). */
  second: string;
  display: string;
  /** Weight for the display face; Young Serif has only 400. */
  displayWeight: number;
  radius: string;
  controlRadius: string;
  inputRadius: string;
}

const THEMES: Record<string, ShopTheme> = {
  // Speckled stoneware: sage studio walls, fired-clay buttons.
  "juniper-clay": {
    bg: "#F1F3EE",
    surface: "#FBFCFA",
    tile: "#E3E8DE",
    ink: "#1F261F",
    muted: "#59625A",
    line: "#D3D9CD",
    accent: "#994A2E",
    accentInk: "#FFFFFF",
    accentSoft: "#F2E2D8",
    second: "#6F8466",
    display: "var(--font-sf-young), Georgia, serif",
    displayWeight: 400,
    radius: "14px",
    controlRadius: "10px",
    inputRadius: "10px",
  },
  // Lake Superior in November: cold blue-green, copper from the roaster.
  "northpaw-roasters": {
    bg: "#EDF1F1",
    surface: "#FAFCFC",
    tile: "#DCE5E4",
    ink: "#0F2422",
    muted: "#4D605E",
    line: "#CAD6D5",
    accent: "#1B5654",
    accentInk: "#FFFFFF",
    accentSoft: "#D6E6E4",
    second: "#B4652A",
    display: "var(--font-sf-bricolage), system-ui, sans-serif",
    displayWeight: 600,
    radius: "6px",
    controlRadius: "4px",
    inputRadius: "4px",
  },
  // Dye pots: blackberry berry, a marigold thread.
  "loop-and-lantern": {
    bg: "#F7F2F4",
    surface: "#FFFCFD",
    tile: "#EFE3E9",
    ink: "#2A1526",
    muted: "#665461",
    line: "#E2D3DB",
    accent: "#8A2B59",
    accentInk: "#FFFFFF",
    accentSoft: "#F3DDE8",
    second: "#C98A1E",
    display: "var(--font-sf-alegreya), Georgia, serif",
    displayWeight: 500,
    radius: "18px",
    controlRadius: "999px",
    inputRadius: "12px",
  },
};

const FALLBACK: ShopTheme = {
  bg: "#F3F3F1",
  surface: "#FFFFFF",
  tile: "#E6E6E2",
  ink: "#1E1E1C",
  muted: "#5C5C58",
  line: "#D6D6D1",
  accent: "#2F4B7C",
  accentInk: "#FFFFFF",
  accentSoft: "#DFE5F0",
  second: "#7C6A2F",
  display: "var(--font-sf-body), system-ui, sans-serif",
  displayWeight: 600,
  radius: "10px",
  controlRadius: "8px",
  inputRadius: "8px",
};

export function themeFor(slug: string): ShopTheme {
  return THEMES[slug] ?? FALLBACK;
}

/** CSS custom properties for a shop, set on the storefront root element. */
export function themeStyle(slug: string): CSSProperties {
  const t = themeFor(slug);
  return {
    "--sf-bg": t.bg,
    "--sf-surface": t.surface,
    "--sf-tile": t.tile,
    "--sf-ink": t.ink,
    "--sf-muted": t.muted,
    "--sf-line": t.line,
    "--sf-accent": t.accent,
    "--sf-accent-ink": t.accentInk,
    "--sf-accent-soft": t.accentSoft,
    "--sf-second": t.second,
    "--sf-display": t.display,
    "--sf-display-weight": t.displayWeight,
    "--sf-radius": t.radius,
    "--sf-control-radius": t.controlRadius,
    "--sf-input-radius": t.inputRadius,
  } as CSSProperties;
}
