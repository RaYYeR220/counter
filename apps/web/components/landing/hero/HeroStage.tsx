"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { glazeVar } from "../glaze";
import type { HeroData, Variant } from "../types";
import { mountScene, type ReadoutLine, type Scene } from "./scene";
import s from "./hero.module.css";

const PHASES = ["Arrive", "Ask", "Agree", "Authorize"];
const TRIP_WORDS = ["no", "one", "two", "three", "four", "five", "six"];

/**
 * The hero around the copy: the canvas scene, the readout beside the docked
 * agent, the dot tooltip and the bar that replays a trip.
 */
export function HeroStage({ data, children }: { data: HeroData; children: ReactNode }) {
  const heroRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);

  const [trip, setTrip] = useState(0);
  const [step, setStep] = useState(-1);
  const [lines, setLines] = useState<ReadoutLine[]>([]);
  const [announce, setAnnounce] = useState(false);
  const [hover, setHover] = useState<Variant | null>(null);

  useEffect(() => {
    const hero = heroRef.current,
      stage = stageRef.current,
      canvas = canvasRef.current,
      readout = readoutRef.current,
      tip = tipRef.current;
    if (!hero || !stage || !canvas || !readout || !tip) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false;
    // The canvas labels use the page's face, so wait for it before the first frame.
    const ready = document.fonts?.ready ?? Promise.resolve();
    void ready.then(() => {
      if (cancelled) return;
      sceneRef.current = mountScene(
        { hero, stage, canvas, readout, tip },
        data,
        {
          onTrip: setTrip,
          onStep: setStep,
          onReadout(next, speak) {
            if (next) setLines(next);
            setAnnounce(speak);
          },
          onHover: setHover,
        },
        reduce,
      );
    });
    return () => {
      cancelled = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, [data]);

  return (
    <section ref={heroRef} className={s.hero} id="top" aria-labelledby="hero-title">
      <canvas
        ref={canvasRef}
        className={s.scene}
        role="img"
        aria-label={`${data.shop}'s ${data.variants.length} variants drawn as a cluster of glaze-coloured dots, sized by stock. AI agents arc in from the screen edges, ask for one item, and dock on the exact variant the shop answers with. Copilot asks for a 16 oz ink mug that is sold out; the shop says so, offers two other 16 oz mugs, and the buyer picks the rust one.`}
      />
      {children}
      <div ref={stageRef} className={s.stage} />
      <div ref={readoutRef} className={s.readout} data-on="false" aria-live={announce ? "polite" : "off"} aria-atomic="true">
        {lines.map((line) => (
          <ReadoutRow key={line.key} line={line} />
        ))}
      </div>
      <div ref={tipRef} className={s.tip} data-on={hover ? "true" : "false"} role="tooltip">
        {hover ? <Tip v={hover} name={data.names[hover.product] ?? hover.product} /> : null}
      </div>
      <div className={s.bar}>
        <div className={s.legend} aria-label="How to read the dots">
          <span>
            <svg width="12" height="12" aria-hidden>
              <circle cx="6" cy="6" r="5" fill="var(--cx-sage)" />
            </svg>
            In stock, sized by stock
          </span>
          <span>
            <svg width="12" height="12" aria-hidden>
              <circle cx="6" cy="6" r="4.4" fill="none" stroke="var(--cx-glaze-ink)" strokeWidth="1.2" />
            </svg>
            Sold out
          </span>
          <span>
            <svg width="12" height="12" aria-hidden>
              <circle cx="6" cy="6" r="5" fill="var(--cx-glaze-ink)" />
              <circle cx="7.7" cy="4.4" r="1.2" fill="var(--cx-canvas)" />
            </svg>
            Seconds
          </span>
          <span>
            <svg width="14" height="14" aria-hidden>
              <circle cx="7" cy="7" r="3.6" fill="var(--cx-sage)" />
              <circle cx="7" cy="7" r="6.2" fill="none" stroke="rgba(26,25,21,.45)" strokeDasharray="2 2.4" />
            </svg>
            Made to order
          </span>
        </div>
        <div className={s.ctrl}>
          <div className={s.agents} role="group" aria-label="Replay an agent's trip">
            {data.trips.map((t, i) => (
              <button key={t.agent} type="button" aria-pressed={trip === i} aria-label={`Replay ${t.agent}'s trip`} onClick={() => sceneRef.current?.replay(i)}>
                {t.agent}
              </button>
            ))}
          </div>
          <div className={s.phases} aria-hidden>
            {PHASES.map((p, k) => (
              <Phase key={p} label={p} state={k < step ? "done" : k === step ? "now" : ""} last={k === PHASES.length - 1} />
            ))}
          </div>
        </div>
        <p className={s.caption}>
          {data.shop}&rsquo;s {data.variants.length} real variants and {TRIP_WORDS[data.trips.length] ?? data.trips.length} scripted trips. Click any dot to
          send an agent for it.
        </p>
      </div>
    </section>
  );
}

function Phase({ label, state, last }: { label: string; state: string; last: boolean }) {
  return (
    <>
      <span data-state={state}>{label}</span>
      {last ? null : <em />}
    </>
  );
}

function GlazeDot({ glaze, empty = false }: { glaze: string; empty?: boolean }) {
  return <i className={s.glaze} data-empty={empty} data-oat={glaze === "oat" && !empty} style={{ ["--g" as string]: glazeVar(glaze) }} aria-hidden />;
}

function ReadoutRow({ line }: { line: ReadoutLine }) {
  switch (line.kind) {
    case "head":
      return (
        <div className={`${s.row} ${s.head}`}>
          <b>{line.agent}</b> asks {line.shop}
        </div>
      );
    case "ask":
      return <div className={`${s.row} ${s.ask}`}>{line.text}</div>;
    case "sep":
      return <div className={`${s.row} ${s.sep}`} />;
    case "sku":
      return (
        <div className={`${s.row} ${s.sku}`}>
          <GlazeDot glaze={line.glaze} empty={line.empty} />
          {line.id}
        </div>
      );
    case "fact":
      return (
        <div className={`${s.row} ${s.fact}`}>
          {line.strong ? <b>{line.strong}</b> : null}
          {line.text}
        </div>
      );
    case "accent":
      return <div className={`${s.row} ${s.accent}`}>{line.text}</div>;
    case "muted":
      return <div className={`${s.row} ${s.muted} ${line.small ? s.mutedSmall : ""}`}>{line.text}</div>;
    case "alt":
      return (
        <div className={`${s.row} ${s.alt}`}>
          <GlazeDot glaze={line.glaze} />
          <span>
            {line.label}
            <b>{line.strong}</b>
            {line.rest}
          </span>
        </div>
      );
    case "pick":
      return <div className={`${s.row} ${s.pick}`}>{line.text}</div>;
    case "held":
      return (
        <div className={`${s.row} ${s.held}`}>
          <i className={s.heldRing} aria-hidden />
          <span>
            Authorized in PayPal
            <small>Held until {line.shipper} ships</small>
          </span>
        </div>
      );
  }
}

function Tip({ v, name }: { v: Variant; name: string }) {
  const attrs = [v.glaze, v.size].filter(Boolean).join(", ");
  return (
    <>
      <b>{name}</b>
      <br />
      {attrs}
      <code>{v.id}</code>${v.price}, {v.stock} in stock
      {v.flag === "seconds" ? (
        <>
          <br />
          Sold as a second
        </>
      ) : null}
      {v.flag === "made_to_order" ? (
        <>
          <br />
          Made to order, about {v.lead} days
        </>
      ) : null}
      <span className={s.hint}>Click to send an agent for it</span>
    </>
  );
}
