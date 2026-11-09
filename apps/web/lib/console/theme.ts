// The Console's design tokens and the AG Studio theme built on them.
//
// Every colour, font and radius the Console draws with is a CSS variable
// defined here (`--cx-*`). The Studio theme points each of its params at those
// variables, so the shell, Studio's panels, its grids, its charts and the
// custom widgets all follow one token set: swap the values below and the whole
// Console changes with them. Light and dark are two Studio theme modes
// (`console-light`, `console-dark`) chosen with `data-ag-theme-mode` on the
// Console's root element, which also switches the token values.

import { studioTheme } from "ag-studio";

export const LIGHT_MODE = "console-light";
export const DARK_MODE = "console-dark";
export type ConsoleMode = typeof LIGHT_MODE | typeof DARK_MODE;

type TokenSet = Record<string, string>;

/** Token values per mode. Keys become `--cx-<key>`. */
export const CONSOLE_TOKENS: { shared: TokenSet; light: TokenSet; dark: TokenSet } = {
  shared: {
    font: 'var(--font-geist-sans, "Geist"), ui-sans-serif, system-ui, sans-serif',
    "font-size": "14px",
    "radius-widget": "10px",
    "radius-control": "7px",
    "radius-chip": "999px",
    "space-gutter": "20px",
  },
  light: {
    canvas: "#F1F2F4",
    surface: "#FFFFFF",
    "surface-2": "#F7F8F9",
    "surface-3": "#EDEFF2",
    ink: "#15171C",
    "ink-2": "#3A3F48",
    muted: "#69707B",
    line: "#E2E4E8",
    "line-strong": "#CBD0D6",
    accent: "#2E54D8",
    "accent-ink": "#FFFFFF",
    "accent-soft": "#E8EDFC",
    floor: "#D92D20",
    ok: "#16794C",
    "ok-soft": "#E3F2EA",
    warn: "#9A5B06",
    "warn-soft": "#FBF0DC",
    bad: "#B42318",
    "bad-soft": "#FCE9E7",
    "chart-1": "#2E54D8",
    "chart-2": "#12878A",
    "chart-3": "#8A63D2",
    "chart-4": "#C47F12",
    "chart-5": "#56606E",
    "chart-6": "#C2457A",
    "chart-7": "#3D9A5F",
    "chart-8": "#9AA0A8",
    shadow: "0 1px 2px rgba(21, 23, 28, 0.06)",
  },
  dark: {
    canvas: "#0E1014",
    surface: "#161920",
    "surface-2": "#1C2028",
    "surface-3": "#232833",
    ink: "#ECEEF2",
    "ink-2": "#C5CAD3",
    muted: "#8B93A0",
    line: "#262B34",
    "line-strong": "#363C47",
    accent: "#7D97FF",
    "accent-ink": "#0E1014",
    "accent-soft": "#1E2747",
    floor: "#FF5A4E",
    ok: "#4CC38A",
    "ok-soft": "#12291F",
    warn: "#E6A23C",
    "warn-soft": "#2B2213",
    bad: "#FF6B5E",
    "bad-soft": "#311815",
    "chart-1": "#7D97FF",
    "chart-2": "#3BC1C1",
    "chart-3": "#A98BF0",
    "chart-4": "#E6A23C",
    "chart-5": "#9AA4B2",
    "chart-6": "#E77AA6",
    "chart-7": "#5FC488",
    "chart-8": "#6B7280",
    shadow: "none",
  },
};

export const token = (name: string) => `var(--cx-${name})`;

/** Chart series colours, in the order Studio hands them out. */
export const CHART_SERIES = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6", "chart-7", "chart-8", "ok", "warn"];

function block(selector: string, set: TokenSet): string {
  return `${selector}{${Object.entries(set)
    .map(([k, v]) => `--cx-${k}:${v};`)
    .join("")}}`;
}

/** The token stylesheet for a Console root with class `root`. */
export function tokenCss(root: string): string {
  return [
    block(root, { ...CONSOLE_TOKENS.shared, ...CONSOLE_TOKENS.light }),
    block(`${root}[data-ag-theme-mode="${DARK_MODE}"]`, CONSOLE_TOKENS.dark),
  ].join("\n");
}

const line = (color: string) => ({ width: 1, color: token(color) });

const palette = Object.fromEntries(
  CHART_SERIES.flatMap((name, i) => [
    [`chartPaletteFills${i + 1}Color`, token(name)],
    [`chartPaletteStrokes${i + 1}Color`, token(name)],
  ]),
);

/** Every Studio param, as a token reference. The same set serves both modes; the tokens switch. */
const params = {
  // Shared by Studio's UI, grids and charts.
  fontFamily: token("font"),
  fontSize: 14,
  textColor: token("ink"),
  foregroundColor: token("ink"),
  subtleTextColor: token("muted"),
  backgroundColor: token("surface"),
  borderColor: token("line"),
  accentColor: token("accent"),
  iconColor: token("ink-2"),
  rowHoverColor: token("surface-2"),
  valueChangeUpColor: token("ok"),
  valueChangeDownColor: token("bad"),
  valueChangeHighlightBackgroundColor: token("accent-soft"),

  // Studio fills the page below the Console header; no outer frame.
  studioMinWidth: 0,
  studioMinHeight: 0,
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token("canvas"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token("canvas"),
  studioCanvasPadding: 12,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: token("font"),

  // Widgets: white cards with a hairline border.
  studioWidgetBackgroundColor: token("surface"),
  studioWidgetBorder: line("line"),
  studioWidgetBorderRadius: 10,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: token("font"),
  studioWidgetTitleFontSize: 14,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token("ink"),
  studioWidgetSubtitleFontFamily: token("font"),
  studioWidgetSubtitleFontSize: 12,
  studioWidgetSubtitleTextColor: token("muted"),
  studioWidgetCaptionFontFamily: token("font"),
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: token("muted"),
  studioWidgetResizeBorderColor: token("accent"),

  // Edit and assistant panels.
  studioPanelContainerBackgroundColor: token("surface"),
  studioPanelContainerBorder: line("line"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token("line"),
  studioPanelDividerActiveColor: token("accent"),
  studioPanelSectionBorderColor: token("line"),
  studioPanelHeaderFontFamily: token("font"),
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: token("surface-2"),
  studioPanelChevronButtonHoverColor: token("accent"),
  studioToggleButtonActiveBackgroundColor: token("accent-soft"),
  studioToggleButtonActiveBorderColor: token("accent"),
  studioToggleButtonActiveColor: token("accent"),

  // Grid widgets: quiet headers, tabular rows.
  gridFontFamily: token("font"),
  gridFontSize: 13,
  gridCellTextColor: token("ink"),
  gridHeaderBackgroundColor: token("surface"),
  gridHeaderTextColor: token("muted"),
  gridHeaderFontWeight: 500,
  gridHeaderFontSize: 12,
  gridRowHeight: 38,
  gridRowBorder: line("line"),
  gridHeaderRowBorder: line("line-strong"),
  gridPinnedRowBorder: line("line"),
  gridRowHoverColor: token("surface-2"),
  gridWrapperBorder: false,

  // Charts.
  chartFontFamily: token("font"),
  chartTextColor: token("ink-2"),
  chartSubtleTextColor: token("muted"),
  chartAxisLineColor: token("line-strong"),
  chartGridLineColor: token("line"),
  ...palette,
} as const;

/** The Console's Studio theme, with a light and a dark mode. */
export const consoleTheme = studioTheme
  .withParams({ ...params, browserColorScheme: "light" }, LIGHT_MODE)
  .withParams({ ...params, browserColorScheme: "dark" }, DARK_MODE);
