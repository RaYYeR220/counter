import { Fragment, type ReactNode } from "react";

// The buyer agent answers in plain text with light markdown: paragraphs,
// "- " lists, **bold**, *italics*, [label](url) and bare URLs. Only http(s) links render.

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${i++}`;
    if (m[1] != null) out.push(<strong key={k}>{m[1]}</strong>);
    else if (m[5] != null) out.push(<em key={k}>{m[5]}</em>);
    else if (m[2] != null && m[3] != null) {
      out.push(
        <a key={k} href={m[3]} target="_blank" rel="noopener noreferrer">
          {m[2]}
        </a>,
      );
    } else if (m[4] != null) {
      out.push(
        <a key={k} href={m[4]} target="_blank" rel="noopener noreferrer">
          {m[4].length > 64 ? `${m[4].slice(0, 61)}…` : m[4]}
        </a>,
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*([-*•]|\d+[.)])\s+/;

/** Splits a paragraph into runs of plain lines and runs of list lines, so "Options:\n- a\n- b" reads as a lead-in and a list. */
function runs(lines: string[]): Array<{ list: boolean; lines: string[] }> {
  const out: Array<{ list: boolean; lines: string[] }> = [];
  for (const l of lines) {
    const list = BULLET.test(l);
    const last = out.at(-1);
    if (last && last.list === list) last.lines.push(l);
    else out.push({ list, lines: [l] });
  }
  return out;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.flatMap((block, b) =>
        runs(block.split("\n").filter((l) => l.trim())).map((run, r) => {
          const key = `${b}-${r}`;
          if (run.list) {
            return (
              <ul key={key}>
                {run.lines.map((l, j) => (
                  <li key={j}>{inline(l.replace(BULLET, ""), `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          }
          return (
            <p key={key}>
              {run.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 ? <br /> : null}
                  {inline(l.replace(/^#+\s+/, ""), `${key}-${j}`)}
                </Fragment>
              ))}
            </p>
          );
        }),
      )}
    </div>
  );
}
