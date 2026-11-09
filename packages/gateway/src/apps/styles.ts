/**
 * One stylesheet for every card. Structure colours and type come from the
 * host's MCP Apps style variables when it sends them (so the card sits in the
 * host's theme) and fall back to Counter's own palette. One accent, hairline
 * rules, system fonts.
 */

const LIGHT = `
  --c-surface: var(--color-background-primary, #ffffff);
  --c-surface-2: var(--color-background-secondary, #f7f8f9);
  --c-ink: var(--color-text-primary, #15171c);
  --c-ink-2: var(--color-text-secondary, #3a3f48);
  --c-muted: var(--color-text-tertiary, #69707b);
  --c-line: var(--color-border-tertiary, #e2e4e8);
  --c-line-strong: var(--color-border-secondary, #cbd0d6);
  --c-accent: #2e54d8;
  --c-accent-ink: #ffffff;
  --c-accent-soft: #e8edfc;
  --c-ok: var(--color-text-success, #16794c);
  --c-ok-soft: var(--color-background-success, #e3f2ea);
  --c-warn: var(--color-text-warning, #8a5205);
  --c-warn-soft: var(--color-background-warning, #fbf0dc);
  --c-bad: var(--color-text-danger, #b42318);
  --c-bad-soft: var(--color-background-danger, #fce9e7);
  --c-skeleton: rgba(21, 23, 28, 0.06);
`;

const DARK = `
  --c-surface: var(--color-background-primary, #161920);
  --c-surface-2: var(--color-background-secondary, #1c2028);
  --c-ink: var(--color-text-primary, #eceef2);
  --c-ink-2: var(--color-text-secondary, #c5cad3);
  --c-muted: var(--color-text-tertiary, #8b93a0);
  --c-line: var(--color-border-tertiary, #262b34);
  --c-line-strong: var(--color-border-secondary, #363c47);
  --c-accent: #7d97ff;
  --c-accent-ink: #0e1014;
  --c-accent-soft: #1e2747;
  --c-ok: var(--color-text-success, #4cc38a);
  --c-ok-soft: var(--color-background-success, #12291f);
  --c-warn: var(--color-text-warning, #e6a23c);
  --c-warn-soft: var(--color-background-warning, #2b2213);
  --c-bad: var(--color-text-danger, #ff6b5e);
  --c-bad-soft: var(--color-background-danger, #311815);
  --c-skeleton: rgba(236, 238, 242, 0.07);
`;

export const APP_CSS = `
:root {
  color-scheme: light dark;
  --c-font: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  --c-mono: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace);
  --c-radius: var(--border-radius-lg, 10px);
  --c-radius-sm: var(--border-radius-sm, 6px);
  --c-hair: 1px;
${LIGHT}
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark;
${DARK}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${DARK}
  }
}
@media (min-resolution: 2dppx) { :root { --c-hair: 0.5px; } }

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body {
  font-family: var(--c-font);
  font-size: var(--font-text-sm-size, 14px);
  line-height: 1.45;
  color: var(--c-ink);
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  padding: var(--safe-top, 0) var(--safe-right, 0) var(--safe-bottom, 0) var(--safe-left, 0);
}
button, a { font: inherit; }
.num { font-variant-numeric: tabular-nums; }
.mono { font-family: var(--c-mono); font-size: 12px; letter-spacing: 0; }

.card {
  background: var(--c-surface);
  border: var(--c-hair) solid var(--c-line-strong);
  border-radius: var(--c-radius);
  overflow: hidden;
  min-width: 0;
}
.sec { padding: 14px 16px; }
.sec + .sec { border-top: var(--c-hair) solid var(--c-line); }

.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.head > div { min-width: 0; }
.eyebrow {
  font-size: 12px;
  color: var(--c-muted);
  margin: 0 0 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.title {
  font-size: var(--font-heading-md-size, 16px);
  font-weight: 600;
  line-height: 1.3;
  margin: 0;
  letter-spacing: -0.005em;
}
.desc {
  margin: 8px 0 0;
  color: var(--c-ink-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pill {
  flex: none;
  font-size: 12px;
  line-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: var(--c-hair) solid var(--c-line-strong);
  color: var(--c-ink-2);
  white-space: nowrap;
}
.pill.ok { color: var(--c-ok); background: var(--c-ok-soft); border-color: transparent; }
.pill.warn { color: var(--c-warn); background: var(--c-warn-soft); border-color: transparent; }
.pill.accent { color: var(--c-accent); background: var(--c-accent-soft); border-color: transparent; }

.label { font-size: 12px; color: var(--c-muted); margin: 0 0 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.chip {
  appearance: none;
  border: var(--c-hair) solid var(--c-line-strong);
  background: transparent;
  color: var(--c-ink);
  border-radius: var(--c-radius-sm);
  padding: 5px 10px;
  min-height: 32px;
  font-size: 13px;
  line-height: 1.2;
  cursor: pointer;
  text-align: left;
}
.chip:hover:not(:disabled) { border-color: var(--c-ink-2); }
.chip:focus-visible, .btn:focus-visible, a:focus-visible { outline: 2px solid var(--c-accent); outline-offset: 2px; }
.chip[aria-pressed="true"] { border-color: var(--c-accent); box-shadow: inset 0 0 0 1px var(--c-accent); }
.chip:disabled { cursor: not-allowed; color: var(--c-muted); background: var(--c-surface-2); border-style: dashed; }
.chip .soldout { font-size: 12px; color: var(--c-muted); margin-left: 6px; }
.chip .soldout::before { content: "·"; margin-right: 6px; }

.facts { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.price { font-size: var(--font-heading-lg-size, 20px); font-weight: 600; letter-spacing: -0.01em; }
.stock { font-size: 13px; color: var(--c-ink-2); }
.stock.out { color: var(--c-bad); }
.stock.low { color: var(--c-warn); }
.flags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }

.rows { margin: 0; padding: 0; list-style: none; }
.row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 4px 0; }
.row .k { color: var(--c-ink-2); min-width: 0; }
.row .v { flex: none; text-align: right; }
.row .sub { display: block; font-size: 12px; color: var(--c-muted); }
.row .when { color: var(--c-muted); margin-left: 6px; }
.row.total { padding-top: 8px; margin-top: 4px; border-top: var(--c-hair) solid var(--c-line); font-weight: 600; }
.row.total .k { color: var(--c-ink); }
.row.discount .v { color: var(--c-ok); }
.row.muted .k, .row.muted .v { color: var(--c-muted); font-size: 12px; }

.line { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; }
.line + .line { border-top: var(--c-hair) solid var(--c-line); }
.line .what { min-width: 0; }
.line .name { font-weight: 500; }
.line .attrs { display: block; font-size: 12px; color: var(--c-muted); }
.line .amt { flex: none; text-align: right; }
.line .each { display: block; font-size: 12px; color: var(--c-muted); }

.amount { font-size: var(--font-heading-xl-size, 24px); font-weight: 600; letter-spacing: -0.015em; margin: 6px 0 2px; }
.meta { font-size: 12px; color: var(--c-muted); margin: 0; }
.meta + .meta { margin-top: 2px; }
.note { font-size: 12px; color: var(--c-muted); margin: 0; display: flex; gap: 6px; align-items: flex-start; }
.note svg { flex: none; margin-top: 2px; }

.issues { margin: 0; padding: 10px 12px; list-style: none; border-radius: var(--c-radius-sm); background: var(--c-warn-soft); color: var(--c-warn); }
.issues li { padding: 1px 0; }
.issues.bad { background: var(--c-bad-soft); color: var(--c-bad); }

.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 16px;
  border-radius: var(--c-radius-sm);
  border: var(--c-hair) solid var(--c-line-strong);
  background: transparent;
  color: var(--c-ink);
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  flex: 1 1 200px;
}
.btn:hover { border-color: var(--c-ink-2); }
.btn.primary { background: var(--c-accent); border-color: var(--c-accent); color: var(--c-accent-ink); }
.btn.primary:hover { filter: brightness(1.06); }
.btn[aria-disabled="true"], .btn:disabled { opacity: 0.55; cursor: default; pointer-events: none; }
.status { font-size: 13px; color: var(--c-ink-2); margin: 10px 0 0; min-height: 0; }
.status:empty { display: none; }
.status.warn { color: var(--c-warn); }

.done-mark {
  width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--c-ok-soft); color: var(--c-ok); flex: none;
}
.order-no { font-family: var(--c-mono); font-size: 18px; font-weight: 600; letter-spacing: 0; margin: 6px 0 2px; }
.link { color: var(--c-accent); text-decoration: none; font-weight: 500; }
.link:hover { text-decoration: underline; text-underline-offset: 2px; }

.sk { display: block; height: 10px; border-radius: 4px; background: var(--c-skeleton); }
.sk + .sk { margin-top: 8px; }
.sk.w40 { width: 40%; } .sk.w60 { width: 60%; } .sk.w80 { width: 80%; } .sk.w25 { width: 25%; }
.sk.tall { height: 18px; }
@media (prefers-reduced-motion: no-preference) {
  .sk { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.5; } }
}
.empty { color: var(--c-muted); margin: 0; }
.gap { margin-top: 10px; }

@media (max-width: 360px) {
  .sec { padding: 12px; }
  .btn { flex-basis: 100%; }
}
`;
