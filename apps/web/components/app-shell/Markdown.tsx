import { Fragment, type ReactNode } from "react";

// A small Markdown renderer for Counter's own docs (no user input): headings,
// paragraphs, ordered and unordered lists, pipe tables, fenced code, and inline
// code, bold, italics and links. Anything else renders as plain text.

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}.${i++}`;
    if (m[1] != null) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] != null) out.push(<strong key={k}>{inline(m[2], k)}</strong>);
    else if (m[3] != null) out.push(<em key={k}>{inline(m[3], k)}</em>);
    else if (m[4] != null && m[5] != null) {
      const safe = /^(https?:\/\/|\/|#)/.test(m[5]);
      out.push(
        safe ? (
          <a key={k} href={m[5]}>
            {inline(m[4], k)}
          </a>
        ) : (
          <Fragment key={k}>{m[4]}</Fragment>
        ),
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${n++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      blocks.push(
        <pre key={key}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      const Tag = (["h1", "h2", "h3", "h4"] as const)[level - 1]!;
      blocks.push(
        <Tag key={key} id={slugify(text)}>
          {inline(text, key)}
        </Tag>,
      );
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().match(/^\|?\s*:?-{3,}/)) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={key}>
          <table>
            <thead>
              <tr>
                {head.map((h, j) => (
                  <th key={j} scope="col">
                    {inline(h, `${key}h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{inline(c, `${key}r${ri}c${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const ordered = /^\d+\.\s+/.test(line);
    if (ordered || /^[-*]\s+/.test(line)) {
      const items: string[] = [];
      const marker = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      while (i < lines.length && marker.test(lines[i]!)) {
        let item = lines[i++]!.replace(marker, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!)) item += ` ${lines[i++]!.trim()}`;
        items.push(item);
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${key}i${j}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|```|\||\d+\.\s|[-*]\s)/.test(lines[i]!)) para.push(lines[i++]!.trim());
    if (!para.length) para.push(lines[i++]!.trim());
    blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
  }
  return <>{blocks}</>;
}
