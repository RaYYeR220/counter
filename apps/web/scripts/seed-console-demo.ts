// Seeds a week of plausible agent activity for one shop, so the merchant
// Console has something to show before real agent traffic arrives. Every row
// it writes is marked as demo data (`payload.demo = true` on events, `DEMO-`
// PayPal ids and `<prefix>-D<n>` numbers on orders, `demo: true` in
// negotiation transcripts and market checks), and `--reset` removes exactly
// those rows again. Stock is never changed.
//
// It reads SEED_DATABASE_URL, never DATABASE_URL, so it can't run against the
// app's own database by accident. Point it at a development database only.
//
//   SEED_DATABASE_URL=postgres://... node --experimental-transform-types --import ../../packages/db/scripts/resolve-ts.mjs scripts/seed-console-demo.ts [--shop juniper-clay] [--reset] [--drip 30]
//
//   --shop <slug>   shop to seed (default juniper-clay)
//   --reset         delete this script's demo rows for the shop, then exit
//   --drip <n>      after seeding, add n more agent sessions, one every few seconds, to watch the Console update live

import { carts, createDb, events, getShop, listVariants, negotiations, orders, variants, type Db, type Shop, type Variant } from "@counter/db";
import { and, eq, isNull, like, sql } from "drizzle-orm";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = process.env.SEED_DATABASE_URL;
if (!url) {
  console.error("Set SEED_DATABASE_URL to a development database. This script never reads DATABASE_URL.");
  process.exit(1);
}
const slug = option("shop") ?? "juniper-clay";
const drip = Number(option("drip") ?? 0);

// ---------------------------------------------------------------------------
// Deterministic randomness, so two runs seed the same week.

let seed = 0x5eed_c0de;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));

const AGENTS = [
  { id: "Perplexity", weight: 0.34, ms: [380, 900] },
  { id: "Copilot", weight: 0.24, ms: [420, 1100] },
  { id: "Meta", weight: 0.14, ms: [500, 1300] },
  { id: "Counter MCP", weight: 0.18, ms: [300, 800] },
  { id: "Storefront", weight: 0.1, ms: [250, 650] },
] as const;

function agent() {
  let r = rand();
  for (const a of AGENTS) {
    r -= a.weight;
    if (r <= 0) return a;
  }
  return AGENTS[0];
}

const CITIES = [
  ["Oakland", "CA"],
  ["Seattle", "WA"],
  ["Austin", "TX"],
  ["Brooklyn", "NY"],
  ["Denver", "CO"],
  ["Chicago", "IL"],
  ["Asheville", "NC"],
  ["Minneapolis", "MN"],
] as const;

const dollars = (c: number) => (c / 100).toFixed(2);

// ---------------------------------------------------------------------------

async function reset(db: Db, shop: Shop) {
  const s = shop.slug;
  const ev = await db.delete(events).where(and(eq(events.shopId, s), sql`${events.payload}->>'demo' = 'true'`)).returning({ id: events.id });
  const or = await db.delete(orders).where(and(eq(orders.shopId, s), like(orders.paypalOrderId, "DEMO-%"))).returning({ id: orders.id });
  const ca = await db.delete(carts).where(and(eq(carts.shopId, s), like(carts.id, "DEMO-%"))).returning({ id: carts.id });
  const ne = await db
    .delete(negotiations)
    .where(and(eq(negotiations.shopId, s), sql`${negotiations.transcript} @> '[{"demo": true}]'::jsonb`))
    .returning({ id: negotiations.id });
  const va = await db
    .update(variants)
    .set({ market: null })
    .where(and(eq(variants.shopId, s), sql`${variants.market}->>'demo' = 'true'`))
    .returning({ id: variants.id });
  console.log(`Removed ${ev.length} events, ${or.length} orders, ${ca.length} carts, ${ne.length} negotiations and ${va.length} market checks marked as demo.`);
}

interface Session {
  at: Date;
  agent: (typeof AGENTS)[number];
  lines: Array<{ v: Variant; qty: number; unit: number }>;
  negotiate: boolean;
  checkout: boolean;
  fails: boolean;
}

function planSession(at: Date, catalog: Variant[]): Session {
  const a = agent();
  const n = rand() < 0.7 ? 1 : int(2, 3);
  const lines = Array.from({ length: n }, () => {
    const v = pick(catalog);
    return { v, qty: rand() < 0.75 ? 1 : int(2, 4), unit: v.priceCents };
  });
  return {
    at,
    agent: a,
    lines,
    negotiate: a.id !== "Storefront" && rand() < 0.3,
    checkout: rand() < 0.48,
    fails: rand() < 0.05,
  };
}

let orderNo = 0;

async function writeSession(db: Db, shop: Shop, s: Session, maxDiscountPct: number) {
  const t = (offsetSec: number) => new Date(s.at.getTime() + offsetSec * 1000);
  const ms = () => int(s.agent.ms[0], s.agent.ms[1]);
  const key = `${s.at.getTime().toString(36).toUpperCase()}${int(10, 99)}`;
  const cartId = `DEMO-CART-${key}`;
  const paypalOrderId = `DEMO-PAYPAL-${key}`;
  const rows: Array<typeof events.$inferInsert> = [];
  const ev = (type: string, at: Date, ref: string | null, payload: Record<string, unknown>) =>
    rows.push({ shopId: shop.slug, type, ref, at, payload: { ...payload, agent: s.agent.id, demo: true } });

  // Haggling first, on the first line.
  if (s.negotiate) {
    const line = s.lines[0]!;
    const v = line.v;
    const list = v.priceCents;
    const policyFloor = Math.round(list * (1 - maxDiscountPct / 100));
    const ask = Math.round((list * between(0.66, 0.96)) / 50) * 50;
    let verdict: "accept" | "clamped" | "refuse";
    let final: number;
    let counter: number;
    const allowed = Math.max(v.floorCents, policyFloor);
    if (rand() < 0.08) {
      verdict = "refuse";
      final = list;
      counter = list;
    } else if (ask >= allowed) {
      verdict = "accept";
      final = ask;
      counter = ask;
    } else {
      verdict = "clamped";
      counter = Math.min(list, Math.ceil((allowed + (list - allowed) * 0.4) / 50) * 50);
      final = rand() < 0.5 ? counter : allowed;
    }
    const buyer = `Would you take $${dollars(ask)} each for the ${v.name.toLowerCase()}${line.qty > 1 ? `, ${line.qty} of them` : ""}?`;
    const sellerFirst =
      verdict === "accept"
        ? `Yes, $${dollars(ask)} each works. I've set it aside for you.`
        : verdict === "refuse"
          ? `I can't move on the price for a single ${v.name.toLowerCase()}; it stays $${dollars(list)}.`
          : `I can't go that low, but I can do $${dollars(counter)} each.`;
    const transcript: unknown[] = [
      { from: "buyer", text: buyer, askCents: ask, demo: true },
      { from: "seller", text: sellerFirst, unitCents: counter, verdict, demo: true },
    ];
    if (verdict === "clamped" && final !== counter) {
      transcript.push({ from: "buyer", text: `Meet me at $${dollars(allowed)}?`, askCents: allowed, demo: true });
      transcript.push({ from: "seller", text: `$${dollars(allowed)} is as low as I can go. Deal.`, unitCents: allowed, verdict, demo: true });
    }
    await db.insert(negotiations).values({
      shopId: shop.slug,
      cartId,
      agentClient: s.agent.id,
      variantId: v.variantId,
      transcript,
      outcome: verdict,
      finalUnitCents: final,
      floorCents: v.floorCents,
      createdAt: t(-40),
    });
    ev(`negotiation.${verdict}`, t(-40), null, {
      lines: [{ variant_id: v.variantId, quantity: line.qty, unit: dollars(final), list: dollars(list) }],
      discount: dollars((list - final) * line.qty),
      ms: int(1400, 4200),
    });
    if (verdict !== "refuse") line.unit = final;
  }

  const subtotal = s.lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  const shipping = subtotal >= 7500 ? 0 : 599;
  const tax = Math.round(subtotal * 0.0788);
  const total = subtotal + shipping + tax;
  const [city, state] = pick(CITIES);

  ev("cart.created", t(0), cartId, {
    http: s.fails ? 422 : 201,
    status: "CREATED",
    validation_status: s.fails ? "INVALID" : "VALID",
    total: dollars(total),
    ms: ms(),
  });
  if (s.fails) {
    await db.insert(events).values(rows);
    return { ordered: false };
  }
  if (rand() < 0.25) ev("cart.updated", t(int(20, 90)), cartId, { http: 200, status: "INCOMPLETE", total: dollars(total), ms: ms() });

  const cart = {
    id: cartId,
    items: s.lines.map((l) => ({
      name: l.v.name,
      price: { value: dollars(l.unit), currency_code: "USD" },
      quantity: l.qty,
      parent_id: l.v.parentId,
      variant_id: l.v.variantId,
    })),
    status: s.checkout ? "COMPLETED" : "CREATED",
    totals: {
      subtotal: { value: dollars(subtotal), currency_code: "USD" },
      shipping: { value: dollars(shipping), currency_code: "USD" },
      tax: { value: dollars(tax), currency_code: "USD" },
      total: { value: dollars(total), currency_code: "USD" },
    },
    shipping_address: { admin_area_2: city, admin_area_1: state, country_code: "US" },
    validation_status: "VALID",
  };
  await db.insert(carts).values({
    id: cartId,
    shopId: shop.slug,
    status: s.checkout ? "COMPLETED" : "CREATED",
    cart,
    agentClient: s.agent.id,
    lastTotalCents: total,
    createdAt: t(0),
    updatedAt: t(s.checkout ? 120 : 0),
  });

  if (!s.checkout) {
    await db.insert(events).values(rows);
    return { ordered: false };
  }

  const checkoutAt = t(int(60, 600));
  ev("cart.checkout", checkoutAt, cartId, { http: 200, status: "COMPLETED", total: dollars(total), ms: ms() + 400, paypal_order_id: paypalOrderId });

  orderNo += 1;
  const orderId = `${shop.orderPrefix}-D${String(1000 + orderNo)}`;
  const ageDays = (Date.now() - checkoutAt.getTime()) / 864e5;
  const roll = rand();
  // Older orders have mostly shipped; the last day or two are waiting on the shop.
  const fate =
    ageDays > 1 || (ageDays > 0.4 && roll < 0.5) ? (roll < 0.84 ? "shipped" : roll < 0.93 ? "voided" : "refunded") : "authorized";
  const shippedAt = new Date(checkoutAt.getTime() + Math.min(between(0.3, 1), Math.max(ageDays - 0.05, 0.05)) * 864e5);
  const tracking = fate === "shipped" || fate === "refunded" ? { carrier: pick(["USPS", "UPS"]), trackingNumber: `9400${int(10_000_000, 99_999_999)}${int(1000, 9999)}`, shippedAt: shippedAt.toISOString() } : null;
  await db.insert(orders).values({
    id: orderId,
    shopId: shop.slug,
    cartId,
    paypalOrderId,
    authorizationId: `DEMO-AUTH-${key}`,
    payerId: "DEMOPAYER",
    status: fate === "shipped" ? "captured" : fate,
    totalCents: total,
    platformFeeCents: fate === "shipped" || fate === "refunded" ? 0 : null,
    ...(fate !== "authorized" && fate !== "voided" ? { captureId: `DEMO-CAPTURE-${orderId}` } : {}),
    tracking,
    createdAt: checkoutAt,
    updatedAt: fate === "authorized" ? checkoutAt : shippedAt,
  });
  ev("order.authorized", t(int(600, 640)), orderId, { cartId, totalCents: total, agentClient: s.agent.id });
  if (fate === "shipped" || fate === "refunded") {
    ev("order.captured", shippedAt, orderId, { amount_cents: total, capture_id: `DEMO-CAPTURE-${orderId}` });
    ev("order.shipped", new Date(shippedAt.getTime() + 2000), orderId, { carrier: tracking!.carrier, tracking_number: tracking!.trackingNumber });
  }
  if (fate === "refunded") ev("order.refunded", new Date(shippedAt.getTime() + 2 * 864e5), orderId, { amount_cents: total });
  if (fate === "voided") ev("order.voided", new Date(checkoutAt.getTime() + 0.5 * 864e5), orderId, { reason: "buyer asked to cancel", by: "merchant" });

  rows.sort((a, b) => (a.at as Date).getTime() - (b.at as Date).getTime());
  // Events that land after "now" (a session started a minute ago) are clamped to now.
  const now = Date.now();
  for (const r of rows) if ((r.at as Date).getTime() > now) r.at = new Date(now);
  await db.insert(events).values(rows);
  return { ordered: true };
}

async function seedMarket(db: Db, shop: Shop, catalog: Variant[]) {
  const byParent = new Map<string, Variant[]>();
  for (const v of catalog) if (v.market == null) byParent.set(v.parentId, [...(byParent.get(v.parentId) ?? []), v]);
  let n = 0;
  for (const rows of byParent.values()) {
    const ref = rows.map((r) => r.priceCents).sort((a, b) => a - b)[Math.floor(rows.length / 2)]!;
    const median = Math.round((ref * between(0.86, 1.14)) / 50) * 50;
    const low = Math.round(median * between(0.74, 0.86));
    const high = Math.round(median * between(1.16, 1.32));
    const checkedAt = new Date(Date.now() - between(0.2, 3) * 864e5).toISOString();
    for (const r of rows) {
      const position = r.priceCents < low ? "below" : r.priceCents > high ? "above" : "within";
      await db
        .update(variants)
        .set({ market: { comparable: [], lowCents: low, medianCents: median, highCents: high, position, priceCents: r.priceCents, checkedAt, demo: true } })
        .where(and(eq(variants.id, r.id), isNull(variants.market)));
      n++;
    }
  }
  return n;
}

async function main() {
  const db = createDb(url);
  const shop = await getShop(db, slug);
  if (!shop) throw new Error(`No shop called ${slug} in this database`);
  if (flag("reset")) {
    await reset(db, shop);
    return;
  }
  const existing = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.shopId, slug), sql`${events.payload}->>'demo' = 'true'`));
  if ((existing[0]?.n ?? 0) > 0 && !drip) {
    console.log(`${slug} already has demo activity; run with --reset first to seed it again.`);
    return;
  }
  const done = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.shopId, slug), like(orders.id, `${shop.orderPrefix}-D%`)));
  orderNo = done[0]?.n ?? 0;

  const catalog = (await listVariants(db, slug)).filter((v) => v.active && v.purchasable);
  const maxDiscount = shop.policy.negotiation.enabled ? shop.policy.negotiation.max_discount_pct : 0;

  if ((existing[0]?.n ?? 0) === 0) {
    // A week of sessions: busier in the evening, a little busier each day.
    const start = Date.now() - 7 * 864e5;
    const sessions: Session[] = [];
    for (let day = 0; day < 7; day++) {
      const count = int(14, 22) + day * 2;
      for (let i = 0; i < count; i++) {
        const hour = rand() < 0.6 ? between(16, 23) : between(7, 16);
        const at = new Date(start + day * 864e5 + hour * 36e5);
        if (at.getTime() < Date.now() - 60_000) sessions.push(planSession(at, catalog));
      }
    }
    // A few in the last hour so the stream is current.
    for (let i = 0; i < 4; i++) sessions.push(planSession(new Date(Date.now() - between(3, 55) * 60_000), catalog));
    sessions.sort((a, b) => a.at.getTime() - b.at.getTime());
    let ordered = 0;
    for (const s of sessions) if ((await writeSession(db, shop, s, maxDiscount)).ordered) ordered++;
    const market = await seedMarket(db, shop, catalog);
    console.log(`Seeded ${sessions.length} agent sessions (${ordered} orders) and ${market} market checks for ${shop.name}, all marked as demo.`);
  }

  for (let i = 0; i < drip; i++) {
    await new Promise((r) => setTimeout(r, between(2500, 6000)));
    const s = planSession(new Date(), catalog);
    s.checkout = rand() < 0.7;
    await writeSession(db, shop, s, maxDiscount);
    console.log(`Live session ${i + 1}/${drip}: ${s.agent.id}${s.checkout ? ", checked out" : ""}`);
  }
}

await main();
