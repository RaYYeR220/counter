/** The token that colours a Juniper Clay glaze (sage, ink, oat, rust). */
export function glazeVar(glaze: string): string {
  return glaze === "ink" ? "var(--cx-glaze-ink)" : `var(--cx-${glaze}, var(--cx-ink-2))`;
}
