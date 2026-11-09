/** One line of text in a generated PDF. Long lines wrap to the page width. */
export interface PdfLine {
  text: string;
  /** Font size in points; default 10. */
  size?: number;
  bold?: boolean;
  /** Extra space above the line, in points. */
  gap?: number;
  /** Left indent in points. */
  indent?: number;
  /** Draw a thin rule under the line (for section headings). */
  rule?: boolean;
}

export interface PdfMeta {
  title: string;
  /** ISO timestamp for the document's creation date. */
  createdAt?: string;
  /** Printed at the foot of every page with the page number. */
  footer?: string;
}

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 54;
const FOOTER_Y = 30;

/** Characters outside Latin-1 that Helvetica's WinAnsiEncoding still has. */
const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89,
  "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
  "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Text as WinAnsi bytes (one char per byte); anything Helvetica cannot show becomes "?". */
function winAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (WIN_ANSI[ch] !== undefined) out += String.fromCharCode(WIN_ANSI[ch]);
    else if (cp < 0x20) out += " ";
    else if (cp < 0x7f || (cp >= 0xa0 && cp <= 0xff)) out += ch;
    else out += "?";
  }
  return out;
}

function literal(bytes: string): string {
  return `(${bytes.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/** Approximate Helvetica advance width, in 1/1000 em, good enough for wrapping. */
function charWidth(c: string, bold: boolean): number {
  let w: number;
  if (" .,:;'!|iljtfrI".includes(c)) w = 280;
  else if (/[0-9]/.test(c)) w = 556;
  else if (/[A-Z]/.test(c) || "mwMW@%".includes(c)) w = 722;
  else w = 520;
  return bold ? w * 1.06 : w;
}

function textWidth(bytes: string, size: number, bold: boolean): number {
  let w = 0;
  for (const c of bytes) w += charWidth(c, bold);
  return (w * size) / 1000;
}

function wrap(bytes: string, maxWidth: number, size: number, bold: boolean): string[] {
  if (textWidth(bytes, size, bold) <= maxWidth) return [bytes];
  const out: string[] = [];
  let line = "";
  for (const word of bytes.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size, bold) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) out.push(line);
    // A single word wider than the line is cut into pieces.
    let rest = word;
    while (textWidth(rest, size, bold) > maxWidth) {
      let n = rest.length - 1;
      while (n > 1 && textWidth(rest.slice(0, n), size, bold) > maxWidth) n--;
      out.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) out.push(line);
  return out;
}

interface Placed {
  bytes: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  rule: boolean;
}

function layout(lines: PdfLine[]): Placed[][] {
  const pages: Placed[][] = [[]];
  let y = PAGE_H - MARGIN;
  let afterRule = 0;
  for (const l of lines) {
    const size = l.size ?? 10;
    const bold = l.bold ?? false;
    const indent = l.indent ?? 0;
    const leading = size * 1.35;
    const pieces = wrap(winAnsi(l.text), PAGE_W - 2 * MARGIN - indent, size, bold);
    const above = (l.gap ?? 0) + afterRule;
    afterRule = l.rule ? 4 : 0;
    pieces.forEach((bytes, i) => {
      const step = leading + (i === 0 ? above : 0);
      if (y - step < MARGIN) {
        pages.push([]);
        y = PAGE_H - MARGIN;
      } else {
        y -= step;
      }
      pages[pages.length - 1]!.push({ bytes, x: MARGIN + indent, y, size, bold, rule: Boolean(l.rule) && i === pieces.length - 1 });
    });
  }
  return pages;
}

function n(v: number): string {
  return Number(v.toFixed(2)).toString();
}

function pageContent(placed: Placed[], footer: string): string {
  const ops: string[] = [];
  for (const p of placed) {
    ops.push(`BT /${p.bold ? "F2" : "F1"} ${n(p.size)} Tf ${n(p.x)} ${n(p.y)} Td ${literal(p.bytes)} Tj ET`);
    if (p.rule) ops.push(`0.6 w ${n(MARGIN)} ${n(p.y - 4)} m ${n(PAGE_W - MARGIN)} ${n(p.y - 4)} l S`);
  }
  ops.push(`BT /F1 8 Tf ${n(MARGIN)} ${FOOTER_Y} Td ${literal(winAnsi(footer))} Tj ET`);
  return ops.join("\n");
}

function pdfDate(iso: string | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const s = (Number.isNaN(d.getTime()) ? new Date(0) : d).toISOString();
  return `D:${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}${s.slice(11, 13)}${s.slice(14, 16)}${s.slice(17, 19)}Z`;
}

/**
 * A small PDF 1.4 writer: Helvetica text lines on US Letter pages, wrapped
 * and paginated, with a page-numbered footer. No images, no compression.
 */
export function renderPdf(lines: PdfLine[], meta: PdfMeta): Uint8Array {
  const pages = layout(lines);
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 page tree, 3-4 fonts, 5 info, then a page and its content per page.
  pages.forEach((_, i) => pageIds.push(6 + i * 2));
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title ${literal(winAnsi(meta.title))} /Producer (Counter) /CreationDate (${pdfDate(meta.createdAt)}) >>`;
  pages.forEach((placed, i) => {
    const footer = `${meta.footer ?? meta.title}  -  page ${i + 1} of ${pages.length}`;
    const content = pageContent(placed, footer);
    objects[pageIds[i]!] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}
