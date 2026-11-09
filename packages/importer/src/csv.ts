export interface ParsedCsv {
  headers: string[];
  /** Data rows, each padded to the header width. */
  rows: string[][];
}

/** The delimiter used most often on the header line, outside quotes: comma, semicolon or tab. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch]!++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
  return n > 0 ? best : ",";
}

/**
 * RFC 4180 CSV: quoted fields may hold delimiters, doubled quotes and line
 * breaks. Accepts CRLF or LF, a byte order mark, and comma, semicolon or tab
 * delimiters. Blank lines are skipped.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const delim = detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "") records.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) endField();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] !== "\n") endRow();
    } else field += ch;
    i++;
  }
  if (quoted) throw new SyntaxError("CSV has a quote that is never closed");
  if (field !== "" || row.length) endRow();

  const [header = [], ...data] = records;
  const headers = header.map((h) => h.trim());
  const rows = data.map((r) => (r.length >= headers.length ? r : [...r, ...Array<string>(headers.length - r.length).fill("")]));
  return { headers, rows };
}
