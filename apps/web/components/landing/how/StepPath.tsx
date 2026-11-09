"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Lights each step as it scrolls into view and walks its PayPal statuses
 * forward (CREATED → APPROVED → AUTHORIZED). The steps are fully readable
 * without it; this only adds the "now" state.
 */
export function StepPath({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers: number[] = [];
    const light = (step: HTMLElement) => {
      step.dataset.on = "true";
      for (const chain of step.querySelectorAll<HTMLElement>("[data-chain]")) {
        const statuses = [...chain.querySelectorAll<HTMLElement>("[data-status]")];
        const show = (i: number) => statuses.forEach((x, j) => (x.dataset.state = j < i ? "lit" : j === i ? "now" : ""));
        if (reduce) show(statuses.length - 1);
        else statuses.forEach((_, i) => timers.push(window.setTimeout(() => show(i), 250 + i * 650)));
      }
    };
    const steps = [...root.querySelectorAll<HTMLElement>("[data-step]")];
    if (!("IntersectionObserver" in window)) {
      steps.forEach(light);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          light(en.target as HTMLElement);
          io.unobserve(en.target);
        }
      },
      { rootMargin: "0px 0px -30% 0px" },
    );
    steps.forEach((s) => io.observe(s));
    return () => {
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  return (
    <ol ref={ref} className={className}>
      {children}
    </ol>
  );
}
