/** Share of the budget kept from the start of a long output (page URL, title, top of the page). */
const HEAD_SHARE = 0.25;
const HEAD_MAX = 2000;
/** Room for the "[... N characters omitted ...]" line. */
const MARKER_ROOM = 40;

/**
 * Fits a tool output into `max` characters. Keeps a short head (where page
 * URL and title live) and gives the rest of the budget to the tail, cutting
 * at line breaks so no snapshot line is shown half.
 */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const budget = Math.max(0, max - MARKER_ROOM);

  let head = text.slice(0, Math.min(HEAD_MAX, Math.floor(budget * HEAD_SHARE)));
  const headBreak = head.lastIndexOf("\n");
  if (headBreak > 0) head = head.slice(0, headBreak + 1);

  let tail = text.slice(text.length - Math.max(0, budget - head.length));
  const tailBreak = tail.indexOf("\n");
  if (tailBreak >= 0 && tailBreak < tail.length - 1) tail = tail.slice(tailBreak + 1);

  const omitted = text.length - head.length - tail.length;
  return `${head}[... ${omitted} characters omitted ...]\n${tail}`;
}

/** Drops `<think>` blocks some reasoning models put in their content. */
export function stripReasoning(content: string | null | undefined): string {
  if (!content) return "";
  return content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trim();
}
