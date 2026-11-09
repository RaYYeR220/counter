"use client";

import { useEffect, useState } from "react";
import s from "./shell.module.css";

/** A read-only value with a copy button. The confirmation is announced to screen readers. */
export function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = window.setTimeout(() => setState("idle"), 1800);
    return () => window.clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className={s.copyField}>
      <span className={s.copyLabel}>{label}</span>
      <div className={s.copyRow}>
        <code className={mono ? s.copyValue : `${s.copyValue} ${s.copyPlain}`} title={value}>
          {value}
        </code>
        <button type="button" className={s.copyButton} onClick={copy} aria-label={`Copy ${label}`}>
          {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : "Copy"}
        </button>
      </div>
      <span className={s.srOnly} aria-live="polite">
        {state === "copied" ? `${label} copied` : state === "failed" ? "Copy failed; select the text instead" : ""}
      </span>
    </div>
  );
}
