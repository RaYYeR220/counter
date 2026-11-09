"use client";

import { useEffect } from "react";
import { clearCart } from "@/lib/storefront/cart-store";

/** Empties the shop's cart once, after an order is placed from it. */
export function ClearCart({ shop }: { shop: string }) {
  useEffect(() => {
    clearCart(shop);
  }, [shop]);
  return null;
}
