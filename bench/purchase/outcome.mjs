// What each arm actually bought. Pure functions over a run's trace or captures.
import { cents, dollars, normalizeLines } from './grade.mjs';

const linesOf = (c) => normalizeLines((c?.items ?? []).map((i) => ({ variant_id: i.variant_id, quantity: i.quantity })));

function sumTotals(totals) {
  if (!totals.length || totals.some((t) => t == null)) return null;
  return dollars(totals.reduce((s, t) => s + cents(t), 0));
}

/**
 * Counter arm: the carts that completed checkout (the stub approves every
 * payment, so checkout books the order). A cart checked out twice is one
 * order. `last_cart` is the last cart state the agent saw, bought or not.
 */
export function counterOutcome(steps) {
  const done = new Map();
  const orders = [];
  let last = null;
  for (const s of steps) {
    if (s.isError || !s.structured) continue;
    const view = s.tool === 'checkout' ? s.structured.cart : s.tool === 'create_cart' || s.tool === 'update_cart' ? s.structured : null;
    if (view?.cart_id) last = view;
    if (s.tool === 'checkout' && s.structured.completed === true && view?.cart_id) {
      if (!done.has(view.cart_id) && s.structured.order_number) orders.push(s.structured.order_number);
      done.set(view.cart_id, view);
    }
  }
  const carts = [...done.values()];
  return {
    lines: normalizeLines(carts.flatMap(linesOf)),
    total: sumTotals(carts.map((c) => c.totals?.total ?? null)),
    checkouts: carts.length,
    orders,
    last_cart: last ? { cart_id: last.cart_id, lines: linesOf(last), total: last.totals?.total ?? null, status: last.status } : null,
    address: carts[0]?.shipping_address ?? null,
  };
}

/**
 * Storefront arm: the checkouts the storefront captured for the run. The same
 * cart submitted twice (a double click, a retry) counts once; different carts
 * add up, as separate orders would.
 */
export function storefrontOutcome(captures) {
  const distinct = new Map();
  for (const c of captures ?? []) {
    const key = JSON.stringify([normalizeLines(c.lines), c.shipping_address, c.shipping_option ?? null, c.total ?? null]);
    if (!distinct.has(key)) distinct.set(key, c);
  }
  const list = [...distinct.values()];
  return {
    lines: normalizeLines(list.flatMap((c) => c.lines)),
    total: sumTotals(list.map((c) => c.total ?? null)),
    checkouts: list.length,
    address: list[0]?.shipping_address ?? null,
  };
}
