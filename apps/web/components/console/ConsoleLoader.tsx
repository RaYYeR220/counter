"use client";

import dynamic from "next/dynamic";
import type { ConsoleAppProps } from "./ConsoleApp";
import s from "./console.module.css";

// AG Studio only runs in the browser, and it is large: load it on this page only, after hydration.
const ConsoleApp = dynamic(() => import("./ConsoleApp"), {
  ssr: false,
  loading: () => (
    <div className={s.skeleton} aria-busy="true" aria-label="Loading the Console">
      <div className={s.skeletonBar} />
      <div className={s.skeletonGrid}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={s.skeletonCard} />
        ))}
      </div>
    </div>
  ),
});

export function ConsoleLoader(props: ConsoleAppProps) {
  return <ConsoleApp {...props} />;
}
