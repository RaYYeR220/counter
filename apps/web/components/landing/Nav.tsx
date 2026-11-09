"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CounterMark } from "@/components/brand/CounterMark";
import { LINKS } from "@/lib/site";
import l from "./landing.module.css";

const SECTIONS = [
  { href: "#how", label: "How it works" },
  { href: "#agents", label: "Agents" },
  { href: "#shops", label: "Shops" },
  { href: "#numbers", label: "Numbers" },
  { href: "#paypal", label: "PayPal" },
];

/** The landing's header: clear over the hero, a hairline and a frosted ground once the page scrolls. */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={l.nav} data-scrolled={scrolled}>
      <div className={l.navIn}>
        <a className={l.brand} href="#top" aria-label="Counter, back to top">
          <CounterMark />
          Counter
        </a>
        <nav aria-label="Sections">
          <ul className={l.navLinks}>
            {SECTIONS.map((x) => (
              <li key={x.href}>
                <a href={x.href}>{x.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <Link className={`${l.btn} ${l.small} ${l.primary} ${l.navCta}`} href={LINKS.playground}>
          Try the playground
        </Link>
      </div>
    </header>
  );
}
