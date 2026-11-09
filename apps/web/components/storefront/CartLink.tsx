"use client";

import Link from "next/link";
import { useCart } from "@/lib/storefront/cart-store";
import s from "./sf.module.css";

export function CartLink({ shop }: { shop: string }) {
  const lines = useCart(shop);
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  return (
    <Link href={`/s/${shop}/cart`} className={s.cartLink} aria-label={count ? `Cart, ${count} ${count === 1 ? "item" : "items"}` : "Cart, empty"}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 7h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M9 9V6a3 3 0 0 1 6 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>Cart</span>
      {count ? <span className={s.cartCount}>{count}</span> : null}
    </Link>
  );
}
