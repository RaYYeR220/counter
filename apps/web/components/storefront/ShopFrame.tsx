import Link from "next/link";
import type { ReactNode } from "react";
import { money } from "@/lib/storefront/format";
import { themeStyle } from "@/lib/storefront/theme";
import type { ShopSummary } from "@/lib/storefront/types";
import { CartLink } from "./CartLink";
import s from "./sf.module.css";

export interface ShippingRates {
  standardCents: number;
  expressCents: number;
  freeFromCents: number;
}

/** Header, policies footer and theme for every storefront page of a shop. */
export function ShopFrame({ shop, rates, children }: { shop: ShopSummary; rates: ShippingRates; children: ReactNode }) {
  const home = `/s/${shop.slug}`;
  const days = shop.policy.handlingDays;
  return (
    <div className={s.root} style={themeStyle(shop.slug)}>
      <a href="#main" className={s.skip}>
        Skip to content
      </a>
      <p className={s.announce}>Free standard shipping on US orders of {money(rates.freeFromCents)} or more</p>
      <header className={s.header}>
        <div className={`${s.wrap} ${s.headerInner}`}>
          <Link href={home} className={s.brand}>
            {shop.name}
          </Link>
          <nav aria-label="Shop" className={s.nav}>
            <Link href={`${home}#products`} className={`${s.navLink} ${s.navHide}`}>
              Shop
            </Link>
            <Link href={`${home}#about`} className={`${s.navLink} ${s.navHide}`}>
              About
            </Link>
            <CartLink shop={shop.slug} />
          </nav>
        </div>
      </header>

      <main id="main" className={s.main} tabIndex={-1}>
        <div className={s.wrap}>{children}</div>
      </main>

      <footer className={s.footer}>
        <div className={`${s.wrap} ${s.footerGrid}`}>
          <div>
            <p className={s.footerName}>{shop.name}</p>
            <p className={s.footerText}>{shop.tagline}</p>
            <p className={s.footerText}>
              {shop.owner}, {shop.city}
            </p>
          </div>
          <div>
            <h2 className={s.footerHeading}>Shipping</h2>
            <p className={s.footerText}>
              Orders ship from {shop.policy.shipsFrom} within {days} business {days === 1 ? "day" : "days"}. Standard shipping
              is {money(rates.standardCents)}, free on orders of{" "}
              {money(rates.freeFromCents)} or more. Express is {money(rates.expressCents)}. We ship to US addresses only.
            </p>
          </div>
          <div>
            <h2 className={s.footerHeading}>Returns</h2>
            <p className={s.footerText}>
              Returns are accepted within {shop.policy.returnsDays} days of delivery. Payment goes through PayPal, which holds
              it until your order ships.
            </p>
          </div>
        </div>
        <div className={`${s.wrap} ${s.footerBottom}`}>
          <span>© {shop.name}</span>
          <Link href="/" className={s.badge}>
            <span className={s.badgeDot} aria-hidden="true" />
            Agent-ready · Built on PayPal Store Sync
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** Neutral placeholder shown while a shop page loads. */
export function LoadingShell({ label = "Loading the shop" }: { label?: string }) {
  return (
    <div className={s.loadingShell} role="status" aria-label={label}>
      <div className={s.loadingBar} />
      <div className={`${s.wrap} ${s.loadingGrid}`}>
        <div className={`${s.skeleton} ${s.loadingTile}`} />
        <div className={`${s.skeleton} ${s.loadingTile}`} />
        <div className={`${s.skeleton} ${s.loadingTile}`} />
      </div>
    </div>
  );
}
