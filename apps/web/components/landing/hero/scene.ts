// The hero's living object: the demo shop's variants as a cluster of glaze-
// coloured dots (sized by stock), and AI agents that arc in from the screen
// edges, ask for one thing, and dock on the exact variant the shop answers
// with. A sold-out ask is answered as sold out: the agent never docks on it,
// the shop offers what it has, and the buyer picks.
//
// This module owns the canvas and the positions of the readout and tooltip;
// the React component owns their contents through the callbacks.

import type { HeroData, HeroTrip, Variant } from "../types";

export type ReadoutLine =
  | { key: string; kind: "head"; agent: string; shop: string }
  | { key: string; kind: "ask"; text: string }
  | { key: string; kind: "sep" }
  | { key: string; kind: "sku"; id: string; glaze: string; empty: boolean }
  | { key: string; kind: "fact"; strong?: string; text: string }
  | { key: string; kind: "accent"; text: string }
  | { key: string; kind: "muted"; text: string; small?: boolean }
  | { key: string; kind: "alt"; glaze: string; label: string; strong: string; rest: string }
  | { key: string; kind: "pick"; text: string }
  | { key: string; kind: "held"; shipper: string };

export interface SceneElements {
  hero: HTMLElement;
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  readout: HTMLElement;
  tip: HTMLElement;
}

export interface SceneCallbacks {
  /** Index of the scripted trip in focus, or -1 for a trip a visitor started from a dot. */
  onTrip(index: number): void;
  /** 0 arrive, 1 ask, 2 agree, 3 authorize; -1 when nothing is in focus. */
  onStep(step: number): void;
  /** Readout contents; `announce` is true only for trips a person started. */
  onReadout(lines: ReadoutLine[] | null, announce: boolean): void;
  onHover(v: Variant | null): void;
}

export interface Scene {
  replay(index: number): void;
  destroy(): void;
}

type Phase = "arrive" | "ask" | "answer" | "offer" | "pick" | "authorize" | "leave" | "done";
type Durations = Partial<Record<Phase, number>>;

interface Trip extends HeroTrip {
  index: number;
  /** Started by a visitor clicking a dot. */
  custom?: boolean;
  /** Sold out, with no alternatives: the trip ends at the answer. */
  oos?: boolean;
}

interface Entry {
  t: Trip;
  t0: number;
  serial: number;
  D?: Durations;
  anchor?: Point;
}

interface Point {
  x: number;
  y: number;
}

interface Placed extends Variant {
  x: number;
  y: number;
  r: number;
}

const D: Durations = { arrive: 1700, ask: 2300, answer: 2700, offer: 2700, pick: 1600, authorize: 2200, leave: 1500 };
/** The first trip after load runs its approach a little quicker, so the answer lands while the page is fresh. */
const D_FIRST: Durations = { ...D, arrive: 1300, ask: 1500 };
/** Trips a visitor starts from a dot. */
const D_FAST: Durations = { arrive: 1300, ask: 1500, answer: 2400, authorize: 1800, leave: 1300 };
const STEP: Record<Phase, number> = { arrive: 0, ask: 1, answer: 2, offer: 2, pick: 2, authorize: 3, leave: 3, done: -1 };
const RO_MIN = 252;
const RO_MAX = 300;
const RO_GAP = 46;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx,
    cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t;
  const Y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 7; i++) {
      const e = X(t) - x,
        d = dX(t);
      if (Math.abs(e) < 1e-5 || !d) break;
      t -= e / d;
    }
    return Y(clamp(t, 0, 1));
  };
}
const ease = bezier(0.16, 1, 0.3, 1);
const easeIO = bezier(0.65, 0, 0.35, 1);

function bpt(p: Point[], t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p[0]!.x + 3 * u * u * t * p[1]!.x + 3 * u * t * t * p[2]!.x + t * t * t * p[3]!.x,
    y: u * u * u * p[0]!.y + 3 * u * u * t * p[1]!.y + 3 * u * t * t * p[2]!.y + t * t * t * p[3]!.y,
  };
}

function addBusinessDays(d: Date, n: number): Date {
  const out = new Date(d);
  while (n > 0) {
    out.setUTCDate(out.getUTCDate() + 1);
    const w = out.getUTCDay();
    if (w !== 0 && w !== 6) n--;
  }
  return out;
}

export function mountScene(el: SceneElements, data: HeroData, cb: SceneCallbacks, reduce: boolean): Scene {
  const ctx = el.canvas.getContext("2d");
  if (!ctx) return { replay() {}, destroy() {} };

  // Colours and the face come from the page's tokens, so the canvas draws with the same palette as the CSS.
  const css = getComputedStyle(el.hero);
  const tok = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const INK = tok("--cx-ink", "#1a1915");
  const INK_2 = tok("--cx-ink-2", "#57554e");
  const RING = tok("--cx-ring", "#e5533d");
  const RING_INK = tok("--cx-ring-ink", "#c2402c");
  const GROUND = tok("--cx-canvas", "#f2f0ea");
  const FACE = css.fontFamily || "sans-serif";
  const GLAZE: Record<string, string> = {
    sage: tok("--cx-sage", "#9fb291"),
    ink: tok("--cx-glaze-ink", "#262d3a"),
    oat: tok("--cx-oat", "#e9e0cb"),
    rust: tok("--cx-rust", "#a9502e"),
  };
  const glaze = (g: string) => GLAZE[g] ?? INK_2;
  const ink = (a: number) => `rgba(26,25,21,${a.toFixed(3)})`;
  const ring = (a: number) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(RING);
    if (!m) return RING;
    const n = parseInt(m[1]!, 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
  };

  const V: Placed[] = data.variants.map((v) => ({ ...v, x: 0, y: 0, r: 0 }));
  const byId = new Map(V.map((v) => [v.id, v]));
  const get = (id: string) => byId.get(id)!;
  const TRIPS: Trip[] = data.trips.map((t, index) => ({ ...t, index }));

  // ------------------------------------------------------------ delivery dates
  // The Cart API's rule: lead time (calendar days), then the shop's handling, then Standard transit.
  const etas = new Map<number, string>();
  function eta(lead: number): string {
    const hit = etas.get(lead);
    if (hit) return hit;
    const n = new Date();
    let d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + (lead || 0)));
    d = addBusinessDays(d, data.handlingDays);
    d = addBusinessDays(d, data.transitDays);
    const out = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    etas.set(lead, out);
    return out;
  }

  // ------------------------------------------------------------ readout lines
  const head = (t: Trip): ReadoutLine => ({ key: "h", kind: "head", agent: t.agent, shop: data.shop });
  const ask = (t: Trip): ReadoutLine => ({ key: "q", kind: "ask", text: `“${t.ask}”` });
  const sep: ReadoutLine = { key: "sep", kind: "sep" };
  const sku = (v: Variant): ReadoutLine => ({ key: `s:${v.id}`, kind: "sku", id: v.id, glaze: v.glaze, empty: v.stock === 0 });
  const held: ReadoutLine = { key: "held", kind: "held", shipper: data.shipper };
  function facts(v: Variant, per = ""): ReadoutLine[] {
    if (!v.stock)
      return [
        { key: `f:${v.id}`, kind: "fact", strong: "0 in stock.", text: "" },
        { key: `ns:${v.id}`, kind: "accent", text: "Not sold, not swapped." },
      ];
    const out: ReadoutLine[] = [];
    if (v.flag === "made_to_order")
      out.push(
        { key: `f:${v.id}`, kind: "fact", strong: `$${v.price}`, text: `, made to order: about ${v.lead} days` },
        { key: `e:${v.id}`, kind: "fact", text: `Arrives by ${eta(v.lead)}` },
      );
    else out.push({ key: `f:${v.id}`, kind: "fact", strong: `$${v.price}`, text: `${per}, ${v.stock} in stock, arrives by ${eta(v.lead)}` });
    if (v.flag === "seconds") out.push({ key: `sec:${v.id}`, kind: "muted", text: "Sold as a second, and said so." });
    return out;
  }
  function linesFor(t: Trip, ph: Phase, k: number): ReadoutLine[] {
    const v = get(t.sku);
    const a: ReadoutLine[] = [head(t), ask(t)];
    if (ph === "ask") return a;
    const done = ph === "authorize" || ph === "leave";
    if (t.honest) {
      const pick = get(t.honest.pick);
      if (ph === "answer" || ph === "offer") {
        a.push(sep, sku(v), ...facts(v));
        if (ph === "offer") {
          a.push({ key: "o", kind: "muted", text: `Still in ${v.size}, for the buyer to choose:` });
          t.honest.alts.forEach((id, i) => {
            const alt = get(id);
            const label = alt.flag === "seconds" ? `${cap(alt.glaze)}, sold as a second: ` : `${cap(alt.glaze)}: `;
            a.push({ key: `a${i}`, kind: "alt", glaze: alt.glaze, label, strong: `$${alt.price}`, rest: `, ${alt.stock} left` });
          });
        }
        return a;
      }
      a.push(
        sep,
        { key: "was", kind: "muted", small: true, text: `${cap(v.glaze)} ${v.size}: 0 in stock, not swapped.` },
        { key: "pk", kind: "pick", text: `The buyer picks ${pick.glaze}.` },
      );
      if (ph !== "pick" || k > 0.55) a.push(sku(pick), ...facts(pick));
      if (done) a.push(held);
      return a;
    }
    a.push(sep, sku(v), ...facts(v, t.per));
    if (t.deal && (ph !== "answer" || k > 0.5))
      a.push({ key: "deal", kind: "accent", text: `Seller agent: $${t.deal.unit} each for ${words(t.deal.qty)}. Inside the shop's rules.` });
    if (done && !t.oos) a.push(held);
    return a;
  }

  function customTrip(v: Placed): Trip {
    return {
      index: -1,
      agent: "Your agent",
      side: v.x < CX ? "L" : "R",
      lane: v.y < CY ? 0 : 1,
      sku: v.id,
      ask: `${data.names[v.product] ?? v.product}, ${[v.glaze, v.size].filter(Boolean).join(", ")}.`,
      per: v.size === "pair" ? " for the pair" : "",
      custom: true,
      oos: v.stock === 0,
    };
  }

  const phasesOf = (t: Trip): Phase[] =>
    t.honest
      ? ["arrive", "ask", "answer", "offer", "pick", "authorize", "leave"]
      : t.oos
        ? ["arrive", "ask", "answer", "leave"]
        : ["arrive", "ask", "answer", "authorize", "leave"];
  const durOf = (e: Entry, p: Phase) => (e.D ?? (e.t.custom ? D_FAST : D))[p] ?? 0;

  // ------------------------------------------------------------ layout
  // Compact (below 1180px): agents dock from above and below, the readout sits under the cluster.
  // Wider, the readout takes a slot beside the docked agent, and the cluster is sized to leave it free.
  let W = 0,
    H = 0,
    S = 60,
    CX = 0,
    CY = 0,
    compact = false,
    phone = false,
    bandTop = 0,
    bandBot = 0,
    minX = 0,
    maxX = 0;

  function layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = el.hero.getBoundingClientRect().width;
    compact = W < 1180;
    phone = W < 700;
    if (compact) {
      S = clamp(Math.min((W - 30) / 9.15, 58), 26, 58);
      el.stage.style.height = `${Math.round(S * 5.45 + 312)}px`;
    } else el.stage.style.height = "";
    const r = el.hero.getBoundingClientRect();
    H = r.height;
    el.canvas.width = Math.round(W * dpr);
    el.canvas.height = Math.round(H * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const st = el.stage.getBoundingClientRect();
    bandTop = st.top - r.top + (compact ? 0 : 22);
    bandBot = st.bottom - r.top - (compact ? 0 : 20);
    const bandH = bandBot - bandTop;
    CX = W / 2;
    if (compact) CY = bandTop + S * 2.75 + 18;
    else {
      S = clamp(Math.min(Math.min(W, 1660) * 0.0545, bandH / 4.6, (W / 2 - 16 - RO_GAP - RO_MIN) / 4.98), 34, 92);
      CY = bandTop + bandH * 0.5;
    }
    // Hex rows 7-8-9-8-7 hold the shop's 39 variants; column-major order puts each product in its own band.
    const rows = [7, 8, 9, 8, 7];
    const pts: Point[] = [];
    rows.forEach((n, ri) => {
      for (let i = 0; i < n; i++) pts.push({ x: CX + (i - (n - 1) / 2) * S, y: CY + (ri - 2) * S * 0.87 });
    });
    pts.sort((a, b) => a.x - b.x || a.y - b.y);
    V.forEach((v, i) => {
      const p = pts[i] ?? pts[pts.length - 1]!;
      v.x = p.x;
      v.y = p.y;
      v.r = v.stock ? S * (0.085 + 0.064 * Math.sqrt(v.stock)) : S * 0.12;
    });
    minX = CX - 4 * S;
    maxX = CX + 4 * S;
  }

  const entry = (t: Pick<Trip, "side" | "lane">): Point => {
    const x = t.side === "L" ? -36 : W + 36;
    if (compact) return { x, y: t.lane ? CY + S * 3.1 : bandTop - S * 0.6 };
    return { x, y: t.lane ? bandBot + 2 : Math.max(bandTop - H * 0.07, H * 0.36) };
  };
  const approach = (t: Pick<Trip, "side" | "lane">, v: Placed): Point => {
    if (compact) return { x: clamp(v.x, 24, W - 24), y: CY + (t.lane ? 1 : -1) * S * 2.7 };
    return { x: t.side === "L" ? minX - S * 0.98 : maxX + S * 0.98, y: v.y };
  };
  const pathOf = (E: Point, A: Point, t: Pick<Trip, "lane">): Point[] => {
    const dx = A.x - E.x;
    if (compact) return [E, { x: E.x + dx * 0.55, y: E.y }, { x: A.x, y: lerp(E.y, A.y, 0.35) }, A];
    const lift = (t.lane ? 1 : -1) * Math.min(70, H * 0.05);
    return [E, { x: E.x + dx * 0.46, y: E.y + lift }, { x: A.x - dx * 0.36, y: A.y }, A];
  };

  // ------------------------------------------------------------ drawing
  /** A hairline whose alpha ramps along the curve: faint at the screen edge, firm near the agent. */
  function trail(P: Point[], u0: number, u1: number, a0: number, a1: number) {
    if (u1 - u0 < 0.002) return;
    const n = 40;
    let prev = bpt(P, u0);
    ctx!.lineWidth = 1;
    for (let i = 1; i <= n; i++) {
      const q = bpt(P, lerp(u0, u1, i / n));
      ctx!.beginPath();
      ctx!.moveTo(prev.x, prev.y);
      ctx!.lineTo(q.x, q.y);
      ctx!.strokeStyle = ink(lerp(a0, a1, i / n));
      ctx!.stroke();
      prev = q;
    }
  }
  function circle(x: number, y: number, r: number, stroke: string, w = 1, dash: number[] = []) {
    ctx!.beginPath();
    ctx!.arc(x, y, r, 0, Math.PI * 2);
    ctx!.strokeStyle = stroke;
    ctx!.lineWidth = w;
    ctx!.setLineDash(dash);
    ctx!.stroke();
    ctx!.setLineDash([]);
  }
  function disc(x: number, y: number, r: number, fill: string) {
    ctx!.beginPath();
    ctx!.arc(x, y, r, 0, Math.PI * 2);
    ctx!.fillStyle = fill;
    ctx!.fill();
  }
  function drawDot(v: Placed, alpha: number) {
    const c = glaze(v.glaze);
    ctx!.globalAlpha = alpha;
    if (v.stock === 0) circle(v.x, v.y, v.r, v.glaze === "oat" ? ink(0.38) : c, 1.25);
    else {
      disc(v.x, v.y, v.r, c);
      if (v.glaze === "oat") circle(v.x, v.y, v.r, ink(0.2), 1);
      // The pinhole that makes it a second.
      if (v.flag === "seconds") disc(v.x + v.r * 0.34, v.y - v.r * 0.3, Math.max(1.3, v.r * 0.13), GROUND);
    }
    if (v.flag === "made_to_order") circle(v.x, v.y, v.r + 4.5, ink(0.42), 1, [2, 3]);
    ctx!.globalAlpha = 1;
  }
  function text(str: string, x: number, y: number, color: string, size: number) {
    ctx!.font = `500 ${size}px ${FACE}`;
    const hw = ctx!.measureText(str).width / 2 + 6;
    ctx!.textAlign = "center";
    ctx!.textBaseline = "middle";
    ctx!.fillStyle = color;
    ctx!.fillText(str, clamp(x, hw, W - hw), y);
  }
  const tag = (str: string, v: Placed, color: string) => text(str, v.x, v.y - v.r - (phone ? 9 : 12), color, phone ? 10.5 : 11.5);

  // ------------------------------------------------------------ timeline
  let active: Entry[] = [];
  let focus: Entry | null = null;
  let loopIdx = 0;
  let born = performance.now();
  let ambient: Array<{ v: Placed; side: "L" | "R"; lane: 0 | 1; t0: number; d: [number, number, number] }> = [];
  let nextAmb = 0;
  let announce = false;
  let serial = 0;

  function startTrip(t: Trip, user: boolean) {
    const now = performance.now();
    if (user) {
      active = [];
      ambient = [];
    }
    active = active.filter((a) => a.t !== t);
    const e: Entry = { t, t0: now, serial: ++serial };
    active.push(e);
    focus = e;
    announce = user;
    if (t.index >= 0) loopIdx = t.index;
    cb.onTrip(t.index);
    return e;
  }
  function stateOf(e: Entry, now: number): { phase: Phase; k: number } {
    const ph = phasesOf(e.t);
    if (reduce) return { phase: ph.includes("authorize") ? "authorize" : "answer", k: 1 };
    let el = now - e.t0;
    for (const p of ph) {
      const d = durOf(e, p);
      if (el < d) return { phase: p, k: el / d };
      el -= d;
    }
    return { phase: "done", k: 1 };
  }

  // ------------------------------------------------------------ readout
  let lastKeys = "";
  let roFor: Entry | null = null;
  let lastStep = -2;
  function setReadout(e: Entry | null, st: { phase: Phase; k: number }) {
    if (!e || st.phase === "arrive" || st.phase === "done" || (st.phase === "leave" && st.k > 0.45)) {
      if (lastKeys !== "") cb.onReadout(null, false);
      lastKeys = "";
      el.readout.dataset.on = "false";
      return;
    }
    const lines = linesFor(e.t, st.phase, st.k);
    const keys = lines.map((l) => l.key).join("|");
    if (keys !== lastKeys || roFor !== e) {
      cb.onReadout(
        lines.map((l) => ({ ...l, key: `${e.serial}.${l.key}` })),
        announce,
      );
      lastKeys = keys;
      roFor = e;
    }
    el.readout.dataset.on = "true";
    const anchor = e.anchor;
    if (!anchor) return;
    if (compact) {
      const w = Math.min(W - 32, 460);
      el.readout.style.width = `${w}px`;
      el.readout.style.left = `${(W - w) / 2}px`;
      el.readout.style.top = `${CY + S * 2.7 + 30}px`;
      return;
    }
    const rh = el.readout.offsetHeight;
    const room = e.t.side === "L" ? anchor.x - RO_GAP - 16 : W - anchor.x - RO_GAP - 16;
    const rw = clamp(room, RO_MIN, RO_MAX);
    el.readout.style.width = `${rw}px`;
    const top = clamp(CY - S * 1.9, bandTop - 8, Math.max(bandTop, bandBot - rh));
    const left = clamp(e.t.side === "L" ? anchor.x - RO_GAP - rw : anchor.x + RO_GAP, 14, W - rw - 14);
    el.readout.style.left = `${left}px`;
    el.readout.style.top = `${top}px`;
  }

  // ------------------------------------------------------------ frame
  let hover: Placed | null = null;
  let running = false;
  let raf = 0;

  function frame(now: number) {
    const c = ctx!;
    c.clearRect(0, 0, W, H);
    const intro = reduce ? 1 : clamp((now - born - 200) / 1100, 0, 1);

    // The scripted loop: the next trip leaves the edge while the last one heads out.
    if (!reduce) {
      const next = TRIPS[(loopIdx + 1) % TRIPS.length]!;
      if (!focus || stateOf(focus, now).phase === "done") startTrip(next, false);
      else {
        const st = stateOf(focus, now);
        if (st.phase === "leave" && st.k > 0.2 && !active.some((a) => a.t === next)) startTrip(next, false);
      }
      active = active.filter((a) => stateOf(a, now).phase !== "done");
    }

    // Guide lanes: four faint routes in from the edges.
    if (!compact) {
      for (const side of ["L", "R"] as const)
        for (const lane of [0, 1] as const) {
          const g = { side, lane };
          const A = { x: side === "L" ? minX - S * 0.98 : maxX + S * 0.98, y: CY + (lane ? 1 : -1) * S * 0.6 };
          trail(pathOf(entry(g), A, g), 0, intro, 0, 0.085);
        }
    }

    const states = active.map((e) => ({ e, t: e.t, s: stateOf(e, now) }));
    const F = states.find((o) => o.e === focus);

    // While the focused agent asks, rings narrow: the product, then the glaze, then the one variant.
    const rings = new Map<Placed, { c: string; w: number }>();
    if (F && F.s.phase === "ask") {
      const tv = get(F.t.sku),
        k = F.s.k;
      const lvl = k < 0.36 ? 0 : k < 0.7 ? 1 : 2;
      const fade = lvl === 0 ? clamp(k / 0.12, 0, 1) : 1;
      for (const v of V) {
        const m0 = v.product === tv.product,
          m1 = m0 && v.glaze === tv.glaze;
        if ((lvl === 0 && m0) || (lvl === 1 && m1)) rings.set(v, { c: ink(0.34 * fade), w: 1 });
        if (lvl === 2 && v === tv) rings.set(v, { c: ink(0.62), w: 1.2 });
      }
    }

    // Leaders go under the dots, so a line visibly threads into the cluster to one variant.
    const after: Array<() => void> = [];
    for (const { e, t, s } of states) {
      if (s.phase === "done") continue;
      const isF = e === focus;
      const v0 = get(t.sku),
        vF = get(t.honest?.pick ?? t.sku);
      const A0 = approach(t, v0),
        AF = approach(t, vF);
      let A = t.honest && (s.phase === "authorize" || s.phase === "leave") ? AF : A0;
      const tx = A === AF ? vF : v0;
      let lx = tx.x,
        ly = tx.y;
      if (t.honest && s.phase === "pick") {
        const k = easeIO(clamp((s.k - 0.1) / 0.8, 0, 1));
        A = { x: lerp(A0.x, AF.x, k), y: lerp(A0.y, AF.y, k) };
        lx = lerp(v0.x, vF.x, k);
        ly = lerp(v0.y, vF.y, k);
      }
      const P = pathOf(entry(t), A, t);
      let u = 1;
      if (s.phase === "arrive") u = ease(s.k);
      if (s.phase === "leave") u = 1 - easeIO(s.k);
      const pos = bpt(P, u);
      trail(P, 0, u, 0, (isF ? 0.42 : 0.24) * (s.phase === "leave" ? 1 - s.k * 0.6 : 1));

      if (["answer", "offer", "pick", "authorize", "leave"].includes(s.phase)) {
        let k = 1;
        if (s.phase === "answer") k = ease(clamp(s.k * 2.4, 0, 1));
        if (s.phase === "leave") k = 1 - ease(clamp(s.k * 1.7, 0, 1));
        const miss = (t.honest && (s.phase === "answer" || s.phase === "offer")) || (t.oos && s.phase !== "leave");
        const missLeave = !!t.oos && s.phase === "leave";
        if (k > 0) {
          // A miss stops at the ring's edge: the agent never docks on a sold-out variant.
          const stopShort = miss || missLeave ? v0.r + 6 : 0;
          const ang = Math.atan2(ly - pos.y, lx - pos.x),
            dist = Math.hypot(lx - pos.x, ly - pos.y);
          const len = Math.max(0, (dist - stopShort) * k);
          c.beginPath();
          c.moveTo(pos.x, pos.y);
          c.lineTo(pos.x + Math.cos(ang) * len, pos.y + Math.sin(ang) * len);
          c.strokeStyle = miss || missLeave ? ink(0.5) : RING;
          c.lineWidth = 1.25;
          c.setLineDash(miss || missLeave ? [3, 4] : []);
          c.stroke();
          c.setLineDash([]);
        }
        if (miss) {
          after.push(() => {
            circle(v0.x, v0.y, v0.r + 6, RING, 1.25, [2, 3]);
            tag("0 in stock", v0, RING_INK);
          });
          if (t.honest && s.phase === "offer") {
            const ka = clamp(s.k * 3, 0, 1);
            after.push(() => {
              const [a, b] = t.honest!.alts.map(get) as [Placed, Placed];
              circle(a.x, a.y, a.r + 5, ink(0.55 * ka), 1.1);
              circle(b.x, b.y, b.r + 5, ink(0.55 * ka), 1.1);
              c.globalAlpha = ka;
              tag(`${a.flag === "seconds" ? "second" : a.glaze}, $${Math.round(Number(a.price))}`, a, INK_2);
              tag(`${b.flag === "seconds" ? "second" : b.glaze}, $${Math.round(Number(b.price))}`, b, INK_2);
              c.globalAlpha = 1;
            });
          }
        } else if (t.honest && s.phase === "pick") {
          const kk = clamp((s.k - 0.55) / 0.3, 0, 1);
          after.push(() => {
            circle(v0.x, v0.y, v0.r + 6, ring(0.9 * (1 - s.k)), 1.2, [2, 3]);
            for (const id of t.honest!.alts) {
              const a = get(id);
              circle(a.x, a.y, a.r + 5, ink(0.55 * (1 - kk)), 1.1);
            }
            if (kk > 0) circle(vF.x, vF.y, vF.r + 5, ring(kk), 1.35);
          });
        } else if (!missLeave) {
          after.push(() => circle(tx.x, tx.y, tx.r + 5, ring(k), 1.35));
        }
      }
      // Held: a ring closes round the agent once the payment is authorized.
      if (s.phase === "authorize" || (s.phase === "leave" && !t.oos)) {
        const k = s.phase === "authorize" ? ease(clamp(s.k * 1.6, 0, 1)) : 1;
        after.push(() => {
          circle(pos.x, pos.y, lerp(22, 13, k), ring(0.9 * k), 1.15);
          if (s.phase === "authorize" && s.k < 0.5 && !reduce) circle(pos.x, pos.y, 13 + s.k * 30, ring(0.35 * (1 - s.k * 2)), 1);
        });
      }
      // Carried home: the agent leaves with a dot of the glaze it bought.
      if (s.phase === "leave" && !t.oos) {
        const back = bpt(P, Math.max(0, u - 0.03));
        after.push(() => {
          disc(back.x, back.y, 4.3, glaze(vF.glaze));
          if (vF.glaze === "oat") circle(back.x, back.y, 4.3, ink(0.3), 1);
        });
      }
      after.push(() => {
        disc(pos.x, pos.y, 4.5, INK);
        circle(pos.x, pos.y, 8.5, ink(0.32), 1);
        text(t.agent, pos.x, pos.y + (t.lane === 1 ? 21 : -19), isF ? INK : INK_2, phone ? 12 : 13);
      });
      if (isF) e.anchor = A;
    }

    // Ambient traffic: unnamed agents docking on in-stock variants, quietly, on the side away from the readout.
    if (!reduce && !compact && intro >= 1) {
      if (now > nextAmb && ambient.length < 2) {
        const side: "L" | "R" = focus ? (focus.t.side === "L" ? "R" : "L") : Math.random() < 0.5 ? "L" : "R";
        const pool = V.filter(
          (v) => v.stock > 0 && (!focus || v.id !== focus.t.sku) && (side === "L" ? v.x < CX : v.x > CX) && !ambient.some((a) => a.v === v),
        );
        const v = pool[Math.floor(Math.random() * pool.length)];
        if (v) ambient.push({ v, side, lane: Math.random() < 0.5 ? 0 : 1, t0: now, d: [1700, 750, 1400] });
        nextAmb = now + 2300 + Math.random() * 2200;
      }
      ambient = ambient.filter((a) => now - a.t0 < a.d[0] + a.d[1] + a.d[2]);
      for (const a of ambient) {
        const el2 = now - a.t0,
          g = { side: a.side, lane: a.lane };
        const A = { x: a.v.x + (a.side === "L" ? -1 : 1) * (a.v.r + 8), y: a.v.y };
        const P = pathOf(entry(g), A, g);
        let u = 1,
          touch = 0;
        if (el2 < a.d[0]) u = ease(el2 / a.d[0]);
        else if (el2 < a.d[0] + a.d[1]) touch = (el2 - a.d[0]) / a.d[1];
        else u = 1 - easeIO((el2 - a.d[0] - a.d[1]) / a.d[2]);
        const p = bpt(P, u);
        trail(P, 0, u, 0, 0.16);
        if (touch > 0) {
          const k = ease(clamp(touch * 2.5, 0, 1));
          after.push(() => circle(a.v.x, a.v.y, a.v.r + 4, ink(0.38 * k), 1));
        }
        const leaving = el2 >= a.d[0] + a.d[1];
        after.push(() => {
          if (leaving) {
            const b = bpt(P, Math.max(0, u - 0.035));
            disc(b.x, b.y, 3, glaze(a.v.glaze));
            if (a.v.glaze === "oat") circle(b.x, b.y, 3, ink(0.3), 1);
          }
          disc(p.x, p.y, 3, ink(0.55));
        });
      }
    }

    // The cluster sweeps in left to right on load.
    for (const v of V) {
      const appear = reduce ? 1 : clamp((now - born - 250 - ((v.x - minX) / (8 * S || 1)) * 650) / 700, 0, 1);
      if (appear <= 0) continue;
      drawDot(v, ease(appear));
      const rg = rings.get(v);
      if (rg) circle(v.x, v.y, v.r + 4, rg.c, rg.w);
      if (hover === v) circle(v.x, v.y, v.r + 4, ink(0.6), 1.2);
    }
    for (const f of after) f();

    const fs = focus ? states.find((o) => o.e === focus) : undefined;
    setReadout(fs ? focus : null, fs ? fs.s : { phase: "done", k: 1 });
    const step = fs && fs.s.phase !== "done" ? STEP[fs.s.phase] : -1;
    if (step !== lastStep) {
      lastStep = step;
      cb.onStep(step);
    }
    if (running && !reduce) raf = requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ pointer
  function hit(x: number, y: number): Placed | null {
    let best: Placed | null = null,
      bd = 1e9;
    for (const v of V) {
      const d = Math.hypot(v.x - x, v.y - y);
      if (d < Math.max(v.r + 6, S * 0.42) && d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }
  const local = (e: PointerEvent | MouseEvent) => {
    const r = el.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function placeTip(v: Placed) {
    const tw = el.tip.offsetWidth || 220,
      th = el.tip.offsetHeight || 110;
    el.tip.style.left = `${clamp(v.x + 18, 8, W - tw - 8)}px`;
    el.tip.style.top = `${clamp(v.y - th - 14, 8, H - th - 8)}px`;
  }
  const onMove = (e: PointerEvent) => {
    const { x, y } = local(e);
    const best = hit(x, y);
    el.canvas.style.cursor = best ? "pointer" : "";
    if (best !== hover) {
      hover = best;
      cb.onHover(best);
      if (reduce) frame(performance.now());
    }
    if (best) placeTip(best);
  };
  const onLeave = () => {
    hover = null;
    cb.onHover(null);
    el.canvas.style.cursor = "";
    if (reduce) frame(performance.now());
  };
  const onClick = (e: MouseEvent) => {
    const { x, y } = local(e);
    const v = hit(x, y);
    if (!v) return;
    hover = null;
    cb.onHover(null);
    startTrip(customTrip(v), true);
    if (reduce) frame(performance.now());
  };

  // ------------------------------------------------------------ run, pause offscreen
  let pausedAt = 0;
  function play() {
    if (running || reduce) return;
    running = true;
    if (pausedAt) {
      const d = performance.now() - pausedAt;
      for (const a of active) a.t0 += d;
      for (const a of ambient) a.t0 += d;
      born += d;
      nextAmb += d;
      pausedAt = 0;
    }
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    pausedAt = performance.now();
  }

  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      layout();
      if (reduce) frame(performance.now());
    }, 80);
  };

  let observer: IntersectionObserver | null = null;
  let destroyed = false;
  layout();
  el.canvas.addEventListener("pointermove", onMove);
  el.canvas.addEventListener("pointerleave", onLeave);
  el.canvas.addEventListener("click", onClick);
  window.addEventListener("resize", onResize);
  if (reduce) {
    startTrip(TRIPS[0]!, false);
    frame(performance.now());
  } else {
    born = performance.now();
    nextAmb = born + 3200;
    const first = startTrip(TRIPS[0]!, false);
    first.D = D_FIRST;
    first.t0 -= 300;
    play();
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver((es) => es.forEach((en) => (en.isIntersecting ? play() : pause())), { threshold: 0 });
      observer.observe(el.hero);
    }
  }

  return {
    replay(index: number) {
      if (destroyed) return;
      const t = TRIPS[index];
      if (!t) return;
      startTrip(t, true);
      if (reduce) frame(performance.now());
    },
    destroy() {
      destroyed = true;
      pause();
      observer?.disconnect();
      window.clearTimeout(resizeTimer);
      el.canvas.removeEventListener("pointermove", onMove);
      el.canvas.removeEventListener("pointerleave", onLeave);
      el.canvas.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
      el.stage.style.height = "";
    },
  };
}

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function words(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}
