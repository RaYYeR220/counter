"use client";

import { useEffect, useSyncExternalStore } from "react";
import { STORED_DARK, STORED_LIGHT, THEME_KEY, type AppTheme } from "@/lib/app-theme/theme";
import s from "./shell.module.css";

const CHANGED = "counter:theme";

function themeRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".app-theme");
}

function effectiveTheme(): AppTheme {
  const forced = themeRoot()?.getAttribute("data-theme");
  if (forced === "dark" || forced === "light") return forced;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    media?.removeEventListener("change", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

function setRootTheme(theme: AppTheme): void {
  themeRoot()?.setAttribute("data-theme", theme);
  window.dispatchEvent(new Event(CHANGED));
}

/** Switches the surface between light and dark and remembers the choice (shared with the Console). */
export function ThemeToggle() {
  const theme = useSyncExternalStore<AppTheme | null>(subscribe, effectiveTheme, () => null);

  // The inline boot script only runs on a full page load; after a client-side
  // navigation the saved choice is applied here.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === STORED_DARK) setRootTheme("dark");
      else if (saved === STORED_LIGHT) setRootTheme("light");
    } catch {
      // Storage blocked: the system setting applies.
    }
  }, []);

  const toggle = () => {
    const next: AppTheme = effectiveTheme() === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(THEME_KEY, next === "dark" ? STORED_DARK : STORED_LIGHT);
    } catch {
      // Storage blocked: the switch still applies to this page.
    }
    setRootTheme(next);
  };

  const dark = theme === "dark";
  return (
    <button type="button" className={s.iconButton} onClick={toggle} aria-label={dark ? "Use light theme" : "Use dark theme"}>
      {dark ? (
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
          <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M4.3 15.7l1.6-1.6M14.1 5.9l1.6-1.6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
          <path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
