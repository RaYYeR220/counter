import type { ReactNode } from "react";
import type { ArtSubject } from "@/lib/storefront/types";

// Product drawings, made from the variant's own attributes: a mug in its glaze
// and size, a coffee bag labelled with its roast, a skein in its colorway.
// Shared by server and client components; no hooks, no external images.

type Kind = "mug" | "bowl" | "serving" | "plate" | "pourover" | "bag" | "skein" | "parcel";

interface Glaze {
  body: string;
  shade: string;
  rim: string;
  speck: string;
}

const GLAZES: Record<string, Glaze> = {
  sage: { body: "#9DAD8D", shade: "#7C8E6D", rim: "#BAC6AC", speck: "#4C5843" },
  ink: { body: "#2B3137", shade: "#1C2126", rim: "#46647F", speck: "#0E1215" },
  oat: { body: "#E7DDC8", shade: "#CEC1A7", rim: "#F4EEE1", speck: "#86765E" },
  rust: { body: "#A5502E", shade: "#823B20", rim: "#C66C43", speck: "#4F2311" },
};

const CLAY = { body: "#CDB797", speck: "#6B5843" };

const COLORWAYS: Record<string, string[]> = {
  harbor: ["#123F4A", "#1D5A68", "#2A7684", "#3D93A0", "#62B1B9"],
  ember: ["#6B2A14", "#8F3B1E", "#B5532A", "#CF7240", "#E2955F"],
  "fog line": ["#6C7782", "#86919A", "#A0AAB2", "#BAC1C7", "#D2D7DB"],
  marigold: ["#A66911", "#C6851A", "#DDA12A", "#EDBD45", "#F6D676"],
  "blackberry jam": ["#2A0F29", "#46183F", "#621E57", "#8A2A6B", "#B33B80"],
};

const WEIGHTS: Record<string, { thick: number; strand: number }> = {
  fingering: { thick: 40, strand: 1.2 },
  dk: { thick: 46, strand: 1.6 },
  worsted: { thick: 52, strand: 2 },
  bulky: { thick: 60, strand: 2.7 },
};

interface BagStyle {
  bag: string;
  shade: string;
  label: string;
  ink: string;
  title: string;
}

const KRAFT = { bag: "#C9AB80", shade: "#AE9067" };
const BAGS: Record<string, BagStyle> = {
  "NP-GUJI": { ...KRAFT, label: "#F3E2A4", ink: "#3A2E12", title: "Guji Hambela" },
  "NP-HUILA": { ...KRAFT, label: "#E8A28B", ink: "#3B1A10", title: "Huila" },
  "NP-HUILA-DECAF": { ...KRAFT, label: "#E8A28B", ink: "#3B1A10", title: "Huila" },
  "NP-LAKEFRONT": { bag: "#1F5856", shade: "#163F3D", label: "#EFE9DA", ink: "#14302E", title: "Lakefront" },
  "NP-NIGHTSHIFT": { bag: "#2C3034", shade: "#1D2023", label: "#D18B4F", ink: "#24160C", title: "Night Shift" },
  "NP-NIGHTSHIFT-DECAF": { bag: "#2C3034", shade: "#1D2023", label: "#D18B4F", ink: "#24160C", title: "Night Shift" },
  "NP-KENYA": { ...KRAFT, label: "#7A3A62", ink: "#FFF4F8", title: "Kenya Nyeri" },
  "NP-CHOICE": { bag: "#E6EBEA", shade: "#CBD4D3", label: "#1F5856", ink: "#F2F7F6", title: "Roaster's Choice" },
};

const ROAST_COLORS: Record<string, string> = { light: "#B9834F", medium: "#7E4B29", dark: "#3A2216" };
const ROAST_LEVEL: Record<string, number> = { light: 1, medium: 2, dark: 3 };

// ---------------------------------------------------------------------------
// Deterministic randomness, so a variant always draws the same way

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function glazeOf(name: string | undefined): Glaze {
  if (name && GLAZES[name.toLowerCase()]) return GLAZES[name.toLowerCase()]!;
  const hue = hash(name ?? "glaze") % 360;
  return {
    body: `hsl(${hue} 22% 62%)`,
    shade: `hsl(${hue} 22% 48%)`,
    rim: `hsl(${hue} 22% 74%)`,
    speck: `hsl(${hue} 25% 25%)`,
  };
}

function colorwayOf(name: string): string[] {
  const known = COLORWAYS[name.toLowerCase()];
  if (known) return known;
  const hue = hash(name) % 360;
  return [24, 34, 46, 58, 70].map((l) => `hsl(${hue} 45% ${l}%)`);
}

export function artKind(s: ArtSubject): Kind {
  const a = s.attributes;
  const cat = s.category.toLowerCase();
  if (a.colorway || cat === "yarn") return "skein";
  if (a.roast || a.grind || a.bag) return "bag";
  if (a.glaze || ["mugs", "bowls", "plates"].includes(cat)) {
    if (cat === "mugs") return "mug";
    if (cat === "plates") return "plate";
    if (cat === "bowls") return a.size ? "bowl" : "serving";
    if (/pour/i.test(s.productName)) return "pourover";
    return "mug";
  }
  return "parcel";
}

/** Text alternative for a drawing: product name and the chosen options. */
export function artLabel(s: ArtSubject, order?: string[]): string {
  const keys = order?.length ? order : Object.keys(s.attributes);
  const values = keys.map((k) => s.attributes[k]).filter(Boolean);
  return `Drawing of ${s.productName}${values.length ? `, ${values.join(", ")}` : ""}`;
}

// ---------------------------------------------------------------------------
// Pottery

function Specks({ seed, n, x, y, w, h, color, inside }: {
  seed: number;
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  inside?: (px: number, py: number) => boolean;
}) {
  const r = rng(seed);
  const dots: ReactNode[] = [];
  for (let i = 0; dots.length < n && i < n * 4; i++) {
    const px = x + r() * w;
    const py = y + r() * h;
    const size = 0.5 + r() * 0.9;
    if (inside && !inside(px, py)) continue;
    dots.push(<circle key={i} cx={px.toFixed(1)} cy={py.toFixed(1)} r={size.toFixed(2)} fill={color} opacity={0.55} />);
  }
  return <g>{dots}</g>;
}

function Shadow({ cx, cy, rx }: { cx: number; cy: number; rx: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={6} fill="#000" opacity={0.09} />;
}

function Mug({ s, seed }: { s: ArtSubject; seed: number }) {
  const g = glazeOf(s.attributes.glaze);
  const size = s.attributes.size ?? "12 oz";
  const [w, h] = size.startsWith("8") ? [78, 70] : size.startsWith("16") ? [92, 106] : [86, 88];
  const ground = 190;
  const x0 = 108 - w / 2;
  const top = ground - h;
  const r = 12;
  const gy = ground - 11;
  const hx = x0 + w;
  const body = `M${x0},${top} L${x0},${ground - r} Q${x0},${ground} ${x0 + r},${ground} L${x0 + w - r},${ground} Q${x0 + w},${ground} ${x0 + w},${ground - r} L${x0 + w},${top} Z`;
  const glazed = `M${x0},${top} L${x0},${gy} C${x0 + w * 0.25},${gy + 3} ${x0 + w * 0.5},${gy - 3} ${x0 + w * 0.75},${gy + 2} S${x0 + w},${gy - 1} ${x0 + w},${gy} L${x0 + w},${top} Z`;
  const handle = `M${hx - 2},${top + 18} C${hx + 36},${top + 14} ${hx + 38},${top + h - 34} ${hx - 2},${top + h - 28}`;
  const seconds = s.flags.includes("seconds");
  const dx = x0 + w * 0.64;
  return (
    <g>
      <Shadow cx={x0 + w / 2 + 12} cy={ground + 1} rx={w / 2 + 28} />
      <path d={handle} fill="none" stroke={g.shade} strokeWidth={13} strokeLinecap="round" />
      <path d={handle} fill="none" stroke={g.body} strokeWidth={6} strokeLinecap="round" opacity={0.85} />
      <path d={body} fill={CLAY.body} />
      <path d={glazed} fill={g.body} />
      <rect x={x0 + w - 20} y={top + 6} width={20} height={gy - top - 6} fill={g.shade} opacity={0.32} />
      <rect x={x0 + 9} y={top + 14} width={9} height={h - 36} rx={4.5} fill="#fff" opacity={0.16} />
      <Specks seed={seed} n={Math.round(w * 0.4)} x={x0 + 3} y={top + 9} w={w - 6} h={h - 12} color={g.speck} />
      <ellipse cx={x0 + w / 2} cy={top} rx={w / 2} ry={7} fill={g.rim} />
      <ellipse cx={x0 + w / 2} cy={top + 0.8} rx={w / 2 - 4.5} ry={5} fill={g.shade} />
      {seconds ? (
        <g>
          <path
            d={`M${dx - 4},${top + 5} L${dx - 4},${top + 30} Q${dx - 4},${top + 38} ${dx},${top + 38} Q${dx + 4},${top + 38} ${dx + 4},${top + 30} L${dx + 4},${top + 5} Z`}
            fill={g.shade}
            opacity={0.9}
          />
          <circle cx={x0 + w * 0.3} cy={top + h * 0.55} r={1.8} fill={g.speck} />
        </g>
      ) : null}
    </g>
  );
}

function Bowl({ s, seed, serving }: { s: ArtSubject; seed: number; serving: boolean }) {
  const g = glazeOf(s.attributes.glaze);
  const large = serving || (s.attributes.size ?? "").startsWith("8");
  const W = serving ? 186 : large ? 152 : 122;
  const H = serving ? 80 : large ? 66 : 54;
  const cx = 120;
  const ground = 182;
  const top = ground - H;
  const L = cx - W / 2;
  const R = cx + W / 2;
  const body = serving
    ? `M${L},${top} C${L + 2},${top + H * 0.62} ${cx - W * 0.3},${ground} ${cx - W * 0.17},${ground} L${cx + W * 0.17},${ground} C${cx + W * 0.3},${ground} ${R - 2},${top + H * 0.62} ${R},${top} Z`
    : `M${L},${top} C${L + 2},${top + H * 0.55} ${L + W * 0.12},${ground} ${cx - W * 0.28},${ground} L${cx + W * 0.28},${ground} C${R - W * 0.12},${ground} ${R - 2},${top + H * 0.55} ${R},${top} Z`;
  const bx = serving ? cx + W * 0.17 : cx + W * 0.28;
  const rightWall = serving
    ? `C${R - 2},${top + H * 0.62} ${cx + W * 0.3},${ground} ${bx},${ground}`
    : `C${R - 2},${top + H * 0.55} ${R - W * 0.12},${ground} ${bx},${ground}`;
  const shade = `M${cx + W * 0.26},${top} L${R},${top} ${rightWall} L${bx - W * 0.1},${ground} Q${cx + W * 0.34},${top + H * 0.5} ${cx + W * 0.26},${top} Z`;
  const foot = serving ? W * 0.16 : W * 0.26;
  const halfAt = (y: number) => {
    const t = (y - top) / H;
    return W / 2 - (W / 2 - (serving ? W * 0.17 : W * 0.28)) * t * t;
  };
  return (
    <g>
      <Shadow cx={cx} cy={ground + 1} rx={W / 2 + 6} />
      <path d={body} fill={g.body} />
      <path d={shade} fill={g.shade} opacity={0.4} />
      <path d={`M${cx - foot - 1},${ground - 8} L${cx + foot + 1},${ground - 8} L${cx + foot},${ground} L${cx - foot},${ground} Z`} fill={CLAY.body} />
      <Specks
        seed={seed}
        n={Math.round(W * 0.32)}
        x={L}
        y={top + 10}
        w={W}
        h={H - 12}
        color={g.speck}
        inside={(px, py) => Math.abs(px - cx) < halfAt(py) - 4}
      />
      <ellipse cx={cx} cy={top} rx={W / 2} ry={serving ? 14 : 11} fill={g.rim} />
      <ellipse cx={cx} cy={top + 1} rx={W / 2 - 5} ry={serving ? 11 : 8.5} fill={g.shade} />
      <ellipse cx={cx + 8} cy={top + 3} rx={W / 2 - 22} ry={serving ? 6 : 4.5} fill={g.body} opacity={0.5} />
    </g>
  );
}

function Plates({ s, seed }: { s: ArtSubject; seed: number }) {
  const g = glazeOf(s.attributes.glaze);
  const set = (s.attributes.set_size ?? "single").toLowerCase();
  const n = set.includes("4") ? 4 : set === "pair" ? 2 : 1;
  const cx = 120;
  const base = 162;
  const rx = 90;
  const ry = 28;
  const plates: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const cy = base - i * 10;
    const isTop = i === n - 1;
    plates.push(
      <g key={i}>
        <ellipse cx={cx} cy={cy + 6} rx={rx - 2} ry={ry} fill={g.shade} />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={g.body} />
        {isTop ? (
          <>
            <ellipse cx={cx} cy={cy + 2} rx={rx * 0.66} ry={ry * 0.6} fill={g.shade} opacity={0.22} />
            <ellipse cx={cx} cy={cy + 2.5} rx={rx * 0.63} ry={ry * 0.56} fill={g.body} />
            <path d={`M${cx - rx + 10},${cy - 6} Q${cx - rx * 0.5},${cy - ry + 2} ${cx},${cy - ry + 3}`} fill="none" stroke="#fff" strokeWidth={2} opacity={0.3} />
            <Specks
              seed={seed}
              n={34}
              x={cx - rx}
              y={cy - ry}
              w={rx * 2}
              h={ry * 2}
              color={g.speck}
              inside={(px, py) => ((px - cx) / (rx - 4)) ** 2 + ((py - cy) / (ry - 3)) ** 2 < 1}
            />
          </>
        ) : null}
      </g>,
    );
  }
  return (
    <g>
      <Shadow cx={cx} cy={base + ry + 2} rx={rx + 4} />
      {plates}
    </g>
  );
}

function PourOver({ s, seed }: { s: ArtSubject; seed: number }) {
  const g = glazeOf(s.attributes.glaze);
  const cx = 116;
  return (
    <g>
      <Shadow cx={cx + 6} cy={197} rx={66} />
      {/* carafe */}
      <path d={`M${cx + 34},${134} C${cx + 66},${136} ${cx + 66},${178} ${cx + 38},${182}`} fill="none" stroke={g.shade} strokeWidth={9} strokeLinecap="round" />
      <path d={`M${cx - 26},120 L${cx + 26},120 L${cx + 30},128 C${cx + 52},140 ${cx + 54},186 ${cx + 34},196 L${cx - 34},196 C${cx - 54},186 ${cx - 52},140 ${cx - 30},128 Z`} fill={g.body} />
      <path d={`M${cx - 28},121 L${cx - 42},116 L${cx - 30},130 Z`} fill={g.body} />
      <rect x={cx + 22} y={130} width={14} height={60} fill={g.shade} opacity={0.4} />
      <Specks seed={seed} n={30} x={cx - 44} y={134} w={88} h={58} color={g.speck} inside={(px) => Math.abs(px - cx) < 40} />
      {/* dripper */}
      <path d={`M${cx - 18},106 C${cx - 46},104 ${cx - 50},86 ${cx - 40},78`} fill="none" stroke={g.shade} strokeWidth={7} strokeLinecap="round" />
      <ellipse cx={cx} cy={116} rx={38} ry={7} fill={g.shade} />
      <path d={`M${cx - 50},62 L${cx + 50},62 L${cx + 22},112 L${cx - 22},112 Z`} fill={g.body} />
      <path d={`M${cx + 30},64 L${cx + 50},62 L${cx + 22},112 L${cx + 12},112 Z`} fill={g.shade} opacity={0.4} />
      <Specks seed={seed + 7} n={26} x={cx - 46} y={66} w={92} h={44} color={g.speck} inside={(px, py) => Math.abs(px - cx) < 50 - (py - 62) * 0.56 - 3} />
      <ellipse cx={cx} cy={62} rx={50} ry={8} fill={g.rim} />
      <ellipse cx={cx} cy={63} rx={45} ry={6} fill={g.shade} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Coffee

function Bag({ s }: { s: ArtSubject }) {
  const style = BAGS[s.parentId] ?? {
    ...KRAFT,
    label: `hsl(${hash(s.parentId) % 360} 40% 78%)`,
    ink: "#222",
    title: s.productName,
  };
  const roast = (s.attributes.roast ?? "").toLowerCase();
  const big = /kg/i.test(s.attributes.bag ?? "");
  const decaf = s.flags.includes("decaf");
  const w = big ? 122 : 100;
  const h = big ? 158 : 130;
  const cx = 120;
  const ground = 198;
  const top = ground - h;
  const L = cx - w / 2;
  const R = cx + w / 2;
  const labelY = top + h * 0.31;
  const labelH = h * 0.57;
  const words = style.title.split(" ");
  const lines = style.title.length > 11 && words.length > 1 ? [words.slice(0, -1).join(" "), words.at(-1)!] : [style.title];
  const level = ROAST_LEVEL[roast] ?? 0;
  const lineH = big ? 15 : 13.5;
  const firstLine = labelY + (decaf ? 14 : 0) + (big ? 18 : 16);
  const beanY = firstLine + (lines.length - 1) * lineH + 12;
  const crimp: ReactNode[] = [];
  for (let x = L + 6; x < R - 4; x += 4) crimp.push(<line key={x} x1={x} y1={top + 2} x2={x} y2={top + 13} stroke="#fff" strokeWidth={0.8} opacity={0.22} />);
  return (
    <g>
      <Shadow cx={cx} cy={ground + 1} rx={w / 2 + 14} />
      <path d={`M${L + 5},${top + 15} L${L},${ground - 10} Q${L},${ground} ${L + 10},${ground} L${R - 10},${ground} Q${R},${ground} ${R},${ground - 10} L${R - 5},${top + 15} Z`} fill={style.bag} />
      <rect x={L + 3} y={top} width={w - 6} height={16} rx={2} fill={style.shade} />
      {crimp}
      <rect x={L - 5} y={top + 20} width={w + 10} height={5} rx={2.5} fill="#C8CCCB" />
      <rect x={R - 15} y={top + 26} width={12} height={h - 36} fill="#000" opacity={0.08} />
      <rect x={L + 7} y={top + 28} width={6} height={h - 44} rx={3} fill="#fff" opacity={0.12} />
      <rect x={L + 12} y={labelY} width={w - 24} height={labelH} rx={3} fill={style.label} />
      {decaf ? (
        <g>
          <rect x={L + 12} y={labelY} width={w - 24} height={14} rx={3} fill="#FFFFFF" />
          <text x={cx} y={labelY + 10} textAnchor="middle" fontSize={9} fontWeight={700} fill="#1B5654" style={{ fontFamily: "var(--sf-display)" }}>
            Decaf
          </text>
        </g>
      ) : null}
      <text textAnchor="middle" fill={style.ink} fontSize={big ? 14 : 12.5} fontWeight={600} style={{ fontFamily: "var(--sf-display)" }}>
        {lines.map((line, i) => (
          <tspan key={i} x={cx} y={firstLine + i * lineH}>
            {line}
          </tspan>
        ))}
      </text>
      <g>
        {[0, 1, 2].map((i) => {
          const filled = roast === "rotating" || i < level;
          const color = roast === "rotating" ? [ROAST_COLORS.light, ROAST_COLORS.medium, ROAST_COLORS.dark][i]! : ROAST_COLORS[roast] ?? "#7E4B29";
          const bx = cx - 14 + i * 14;
          return (
            <g key={i} transform={`translate(${bx} ${beanY}) rotate(-28)`}>
              <ellipse rx={4.8} ry={3.3} fill={filled ? color : "none"} stroke={filled ? "none" : style.ink} strokeWidth={0.8} opacity={filled ? 1 : 0.5} />
              {filled ? <path d="M-3.6,0 Q0,1.4 3.6,0" fill="none" stroke={style.label} strokeWidth={0.8} /> : null}
            </g>
          );
        })}
      </g>
      <text x={cx} y={labelY + labelH - 7} textAnchor="middle" fontSize={9} fill={style.ink} opacity={0.85} style={{ fontFamily: "var(--sf-display)" }}>
        {s.attributes.bag ?? ""}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Yarn

function SkeinShape({ cx, cy, palette, weight, lot, idx, band = true }: {
  cx: number;
  cy: number;
  palette: string[];
  weight: { thick: number; strand: number };
  lot: string;
  idx: number;
  band?: boolean;
}) {
  // A twisted hank: overlapping diagonal lobes, each wound from strands in
  // the colorway's shades.
  const length = 176;
  const K = 9;
  const step = length / K;
  const rx = weight.thick * 0.78;
  const ry = step * 0.62;
  const lobes: ReactNode[] = [];
  for (let k = 0; k < K; k++) {
    const x = cx - length / 2 + step * (k + 0.5);
    const rings: ReactNode[] = [];
    for (let j = 1; j < 5; j++) {
      rings.push(
        <ellipse
          key={j}
          rx={Math.max(1, rx - j * rx * 0.2)}
          ry={Math.max(0.6, ry - j * ry * 0.2)}
          fill="none"
          stroke={palette[(k + j + idx) % palette.length]}
          strokeWidth={weight.strand}
        />,
      );
    }
    lobes.push(
      <g key={k} transform={`translate(${x.toFixed(1)} ${cy}) rotate(-56)`}>
        <ellipse rx={rx} ry={ry} fill={palette[(k + idx) % 2 ? 1 : 2]} stroke={palette[0]} strokeWidth={0.8} />
        {rings}
      </g>,
    );
  }
  const half = weight.thick * 0.66;
  return (
    <g>
      <ellipse cx={cx - length / 2 - 8} cy={cy + 2} rx={10} ry={half * 0.45} fill="none" stroke={palette[2]} strokeWidth={weight.strand * 2} />
      <ellipse cx={cx + length / 2 + 8} cy={cy - 2} rx={9} ry={half * 0.4} fill="none" stroke={palette[3]} strokeWidth={weight.strand * 2} />
      {lobes}
      <rect x={cx - 18} y={cy - half - 4} width={36} height={half * 2 + 8} rx={2} fill="#F6F1E8" stroke="#000" strokeOpacity={0.08} />
      {band ? (
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#3A2E2A" style={{ fontFamily: "var(--sf-display)" }}>
          {lot}
        </text>
      ) : null}
    </g>
  );
}

function Skeins({ s }: { s: ArtSubject }) {
  const colorway = s.attributes.colorway ?? s.productName;
  const palette = colorwayOf(colorway);
  const weight = WEIGHTS[(s.attributes.weight ?? "worsted").toLowerCase()] ?? WEIGHTS.worsted!;
  const lot = s.attributes.dye_lot ?? "";
  const pack = Number(/(\d+)/.exec(s.attributes.pack ?? "1")?.[1] ?? 1);
  if (pack <= 1) {
    return (
      <g>
        <Shadow cx={120} cy={120 + weight.thick * 0.66 + 12} rx={100} />
        <SkeinShape cx={120} cy={120} palette={palette} weight={weight} lot={lot} idx={0} />
      </g>
    );
  }
  const count = Math.min(pack, 5);
  const gap = 34;
  const first = 120 - ((count - 1) * gap) / 2;
  return (
    <g>
      <Shadow cx={120} cy={first + (count - 1) * gap + weight.thick * 0.37 + 12} rx={76} />
      {Array.from({ length: count }, (_, i) => (
        <g key={i} transform={`translate(${120 + (i % 2 ? 7 : -7)} ${first + i * gap}) scale(0.56) translate(-120 -120)`}>
          <SkeinShape cx={120} cy={120} palette={palette} weight={weight} lot={lot} idx={i} band={i === count - 1} />
        </g>
      ))}
    </g>
  );
}

function Parcel({ s }: { s: ArtSubject }) {
  const hue = hash(s.parentId) % 360;
  return (
    <g>
      <Shadow cx={120} cy={186} rx={74} />
      <rect x={58} y={84} width={124} height={100} rx={6} fill={`hsl(${hue} 30% 72%)`} />
      <rect x={58} y={84} width={124} height={22} rx={6} fill={`hsl(${hue} 30% 62%)`} />
      <rect x={112} y={84} width={16} height={100} fill="#fff" opacity={0.35} />
    </g>
  );
}

/** Tight view boxes per drawing; all 240 units wide, so drawings keep one scale. */
const CROPS: Record<Kind, string> = {
  mug: "0 74 240 132",
  bowl: "0 84 240 116",
  serving: "0 84 240 116",
  plate: "0 96 240 108",
  pourover: "0 46 240 160",
  bag: "0 58 240 148",
  skein: "0 66 240 124",
  parcel: "0 70 240 130",
};

export function ProductArt({
  subject,
  label,
  decorative = false,
  crop = false,
  className,
}: {
  subject: ArtSubject;
  /** Trims the empty space above and below the object, for tight layouts. */
  crop?: boolean;
  /** Text alternative; required unless the drawing is decorative. */
  label?: string;
  decorative?: boolean;
  className?: string;
}) {
  const kind = artKind(subject);
  const seed = hash(`${subject.parentId}|${JSON.stringify(subject.attributes)}`);
  let art: ReactNode;
  switch (kind) {
    case "mug":
      art = <Mug s={subject} seed={seed} />;
      break;
    case "bowl":
      art = <Bowl s={subject} seed={seed} serving={false} />;
      break;
    case "serving":
      art = <Bowl s={subject} seed={seed} serving />;
      break;
    case "plate":
      art = <Plates s={subject} seed={seed} />;
      break;
    case "pourover":
      art = <PourOver s={subject} seed={seed} />;
      break;
    case "bag":
      art = <Bag s={subject} />;
      break;
    case "skein":
      art = <Skeins s={subject} />;
      break;
    default:
      art = <Parcel s={subject} />;
  }
  return (
    <svg
      viewBox={crop ? CROPS[kind] : "0 0 240 240"}
      className={className}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : (label ?? artLabel(subject))}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
    >
      {art}
    </svg>
  );
}

/** A small color chip for an option value (glaze, colorway, roast), or null. */
export function swatchColor(key: string, value: string): string | null {
  const v = value.toLowerCase();
  if (key === "glaze") return GLAZES[v]?.body ?? null;
  if (key === "colorway") return COLORWAYS[v]?.[2] ?? null;
  if (key === "roast") return ROAST_COLORS[v] ?? null;
  return null;
}
