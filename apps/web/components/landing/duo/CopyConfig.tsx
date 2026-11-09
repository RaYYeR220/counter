"use client";

import { useEffect, useRef, useState } from "react";
import s from "./duo.module.css";

/** Copies the MCP client config, and says so for a moment. */
export function CopyConfig({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard permission: select a hidden copy and use the older command.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        // Nothing more to try; the config stays on screen to copy by hand.
      }
      ta.remove();
    }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1800);
  };
  return (
    <button type="button" className={s.copy} data-done={done} onClick={() => void copy()}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}
