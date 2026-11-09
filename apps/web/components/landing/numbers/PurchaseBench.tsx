"use client";

import { useState } from "react";
import type { PurchaseArm, PurchaseModel } from "../types";
import s from "./numbers.module.css";

const COLS = 38;
const PITCH = 11;
const RADIUS = 2.7;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Both arms of the purchase benchmark for one model at a time: the figures, one dot per tool call, one mark per task. */
export function PurchaseBench({ models, runsTotal, temperature }: { models: PurchaseModel[]; runsTotal: number; temperature: number }) {
  const [current, setCurrent] = useState(0);
  const model = models[current]!;
  const max = {
    storefront: Math.max(...models.map((m) => sum(m.storefront.steps))),
    counter: Math.max(...models.map((m) => sum(m.counter.steps))),
  };
  return (
    <>
      <div className={s.top}>
        <div className={s.seg} role="group" aria-label="Model">
          {models.map((m, i) => (
            <button key={m.id} type="button" aria-pressed={i === current} onClick={() => setCurrent(i)}>
              {m.label}
              <code>{m.id}</code>
            </button>
          ))}
        </div>
        <p>
          {runsTotal} runs at temperature {temperature}
        </p>
      </div>
      <div className={s.arms}>
        <Arm name="Browser agent" detail="on our storefront, Playwright" arm={model.storefront} max={max.storefront} />
        <Arm name="Counter" detail="MCP tools" arm={model.counter} max={max.counter} />
      </div>
    </>
  );
}

function Arm({ name, detail, arm, max }: { name: string; detail: string; arm: PurchaseArm; max: number }) {
  const calls = sum(arm.steps);
  const rows = Math.ceil(max / COLS);
  return (
    <div className={s.arm}>
      <p className={s.armName}>
        {name} <small>{detail}</small>
      </p>
      <div className={s.figs}>
        <div className={s.fig}>
          <b>
            {arm.correct}/{arm.runs}
          </b>
          <span>correct</span>
        </div>
        <div className={s.fig}>
          <b>{arm.medianSteps}</b>
          <span>median tool calls per task</span>
        </div>
        <div className={s.fig}>
          <b>${arm.costUsd.toFixed(2)}</b>
          <span>for all {arm.runs} tasks</span>
        </div>
      </div>
      <div className={s.field}>
        <svg viewBox={`0 0 ${COLS * PITCH} ${rows * PITCH}`} aria-hidden>
          {Array.from({ length: max }, (_, i) => (
            <circle
              key={i}
              cx={(i % COLS) * PITCH + PITCH / 2}
              cy={Math.floor(i / COLS) * PITCH + PITCH / 2}
              r={RADIUS}
              data-off={i >= calls}
              style={{ transitionDelay: `${(Math.min(i, 500) * 0.0012).toFixed(3)}s` }}
            />
          ))}
        </svg>
        <p className={s.cap}>
          Every dot is one tool call: <b>{calls}</b> across the {arm.runs} tasks
        </p>
      </div>
      <div className={s.tasks} aria-hidden>
        {arm.correctByTask.map((ok, i) => (
          <i key={i} data-miss={!ok} />
        ))}
      </div>
      <p className={s.cap}>
        Each mark is one task.{" "}
        <b>
          {arm.wrongBuys} wrong buy{arm.wrongBuys === 1 ? "" : "s"}
        </b>
        , {arm.missedBuys ? `${arm.missedBuys} missed buy${arm.missedBuys === 1 ? "" : "s"}` : "0 missed"}.
      </p>
    </div>
  );
}
