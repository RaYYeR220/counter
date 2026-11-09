// The Console's AG Studio theme, built on Counter's shared design tokens.
//
// Every colour, font and radius the Console draws with is a `--cx-*` CSS
// variable from lib/app-theme/tokens.css, the same file the landing page,
// Playground, Studio and the docs read. The Studio theme points each of its
// params at those variables, so the shell, Studio's panels, its grids, its
// charts and the custom widgets all follow one token set: change a value in
// tokens.css and every surface follows. Light and dark are two Studio theme
// modes (`console-light`, `console-dark`) chosen with `data-ag-theme-mode` on
// the Console's root element (which carries the `app-theme` class), and
// tokens.css switches the values with it.

import { studioTheme } from "ag-studio";

export const LIGHT_MODE = "console-light";
export const DARK_MODE = "console-dark";
export type ConsoleMode = typeof LIGHT_MODE | typeof DARK_MODE;

export const token = (name: string) => `var(--cx-${name})`;

/** Chart series colours, in the order Studio hands them out. */
export const CHART_SERIES = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6", "chart-7", "chart-8", "ok", "warn"];

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

  // Widgets: cards on the ground with a hairline border.
  studioWidgetBackgroundColor: token("surface"),
  studioWidgetBorder: line("line"),
  studioWidgetBorderRadius: 14,
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
