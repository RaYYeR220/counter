import "server-only";
import { listVariants, type Shop, type Variant } from "@counter/db";
import { quotedAmounts } from "@counter/negotiate";
import { sql } from "drizzle-orm";
import { db, loadShop } from "@/lib/server/runtime";
import { agentFamily, agentLabel } from "../agents";
import type {
  ConsoleEvent,
  ConsoleNegotiation,
  ConsoleOrder,
  ConsoleOrderLine,
  ConsoleShop,
  ConsoleSummary,
  ConsoleTurn,
  ConsoleVariant,
  EventStage,
  Fulfilment,
  MarketSnapshot,
  Verdict,
} from "../types";

/** Internal bookkeeping rows a merchant has no reason to see (stock moves, benchmark captures). */
const HIDDEN_TYPES = ["cart.request", "cart.read", "order.stock_reserved", "order.stock_restored", "bench.checkout"];
const HISTORY_DAYS = 30;

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

function toCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

export function shopView(shop: Shop): ConsoleShop {
  const n = shop.policy.negotiation;
  return {
    slug: shop.slug,
    name: shop.name,
    owner: shop.owner,
    city: shop.city,
    tagline: shop.tagline,
    orderPrefix: shop.orderPrefix,
    negotiation: { enabled: n.enabled, maxDiscountPct: n.max_discount_pct, bundleMinItems: n.bundle_min_items },
  };
}

export async function requireShop(slug: string): Promise<Shop | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return null;
  return loadShop(slug);
}

// ---------------------------------------------------------------------------
// Events

const STAGES: Record<string, EventStage> = {
  "cart.created": "cart",
  "cart.updated": "cart",
  "cart.checkout": "checkout",
  "bench.checkout": "bench",
  "catalog.published": "catalog",
  "catalog.floor_changed": "catalog",
};

function stageOf(type: string): EventStage {
  if (STAGES[type]) return STAGES[type];
  const head = type.split(".")[0];
  if (head === "negotiation") return "negotiation";
  if (head === "order") return "order";
  if (head === "paypal") return "payment";
  if (head === "dispute") return "dispute";
  if (head === "catalog") return "catalog";
  return "other";
}

interface EventRowRaw {
  id: number | string;
  type: string;
  ref: string | null;
  payload: Record<string, unknown>;
  at: Date | string;
  agent: string | null;
  order_total: number | null;
}

function toEvent(r: EventRowRaw): ConsoleEvent {
  const p = r.payload ?? {};
  const agent = r.agent ?? null;
  // Changes the merchant made themselves (floors, catalog) are labelled as theirs, not an agent's.
  const byMerchant = !agent && (p.by === "console" || p.by === "merchant" || r.type.startsWith("catalog."));
  const total =
    toCents(p.total) ??
    toCents(p.totalCents) ??
    toCents(p.amount_cents) ??
    (typeof r.order_total === "number" ? r.order_total : null);
  return {
    id: Number(r.id),
    at: iso(r.at),
    type: r.type,
    stage: stageOf(r.type),
    outcome: r.type.split(".").slice(1).join(".") || r.type,
    ref: r.ref,
    agent,
    agentLabel: byMerchant ? "You" : agentLabel(agent),
    agentFamily: agentFamily(agent),
    totalCents: total,
    ms: typeof p.ms === "number" ? Math.round(p.ms) : null,
    http: typeof p.http === "number" ? p.http : null,
    demo: p.demo === true,
  };
}

/**
 * A shop's activity, newest last. Without `since`, the last `limit` events of
 * the past 30 days; with it, up to `limit` events after that id.
 */
export async function loadEvents(slug: string, opts: { since?: number; limit?: number } = {}): Promise<ConsoleEvent[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 2000), 1), 3000);
  const hidden = sql.join(
    HIDDEN_TYPES.map((t) => sql`${t}`),
    sql`, `,
  );
  const window =
    opts.since != null
      ? sql`e.id > ${opts.since}`
      : sql`e.at > now() - make_interval(days => ${HISTORY_DAYS})`;
  const order = opts.since != null ? sql`e.id asc` : sql`e.id desc`;
  const result = await db().execute(sql`
    select e.id, e.type, e.ref, e.payload, e.at,
           coalesce(e.payload->>'agent', e.payload->>'agentClient', c1.agent_client, c2.agent_client) as agent,
           o.total_cents as order_total
    from events e
    left join carts c1 on c1.id = e.ref and c1.shop_id = e.shop_id
    left join orders o on o.id = e.ref and o.shop_id = e.shop_id
    left join carts c2 on c2.id = o.cart_id
    where e.shop_id = ${slug} and e.type not in (${hidden}) and ${window}
    order by ${order}
    limit ${limit}
  `);
  const list = rows<EventRowRaw>(result).map(toEvent);
  return opts.since != null ? list : list.reverse();
}

// ---------------------------------------------------------------------------
// Orders

interface OrderRowRaw {
  id: string;
  status: ConsoleOrder["status"];
  total_cents: number;
  platform_fee_cents: number | null;
  paypal_order_id: string | null;
  authorization_id: string | null;
  tracking: { carrier?: string; trackingNumber?: string; shippedAt?: string } | null;
  created_at: Date | string;
  updated_at: Date | string;
  agent_client: string | null;
  cart: { items?: Array<{ variant_id?: string; name?: string; quantity?: number; price?: { value?: string } }>; shipping_address?: { admin_area_2?: string; admin_area_1?: string } } | null;
  dispute_status: string | null;
  dispute_reason: string | null;
}

const SIMULATED_PREFIXES = ["DEMO-", "STUB-"];

export function isSimulated(paypalOrderId: string | null, authorizationId: string | null): boolean {
  return SIMULATED_PREFIXES.some((p) => paypalOrderId?.startsWith(p) || authorizationId?.startsWith(p) || authorizationId?.startsWith(`AUTH-${p}`));
}

function fulfilmentOf(status: ConsoleOrder["status"], shipped: boolean): Fulfilment {
  if (status === "voided") return "cancelled";
  if (status === "refunded") return "refunded";
  if (status === "disputed") return "disputed";
  return shipped ? "shipped" : "to_ship";
}

function toOrder(r: OrderRowRaw, now: number): ConsoleOrder {
  const lines: ConsoleOrderLine[] = (r.cart?.items ?? []).map((i) => ({
    variantId: i.variant_id ?? "",
    name: i.name ?? i.variant_id ?? "Item",
    quantity: i.quantity ?? 1,
    unitCents: toCents(i.price?.value) ?? 0,
  }));
  const items = lines.reduce((s, l) => s + l.quantity, 0);
  const summary =
    lines.length === 0 ? "No items recorded" : lines.map((l) => `${l.quantity} × ${l.name}`).join(", ");
  const createdAt = iso(r.created_at);
  const addr = r.cart?.shipping_address;
  const shipped = Boolean(r.tracking?.trackingNumber);
  return {
    id: r.id,
    status: r.status,
    fulfilment: fulfilmentOf(r.status, shipped),
    createdAt,
    updatedAt: iso(r.updated_at),
    totalCents: r.total_cents,
    platformFeeCents: r.platform_fee_cents,
    agent: r.agent_client,
    agentLabel: agentLabel(r.agent_client),
    agentFamily: agentFamily(r.agent_client),
    items,
    lines,
    summary,
    shipTo: addr ? [addr.admin_area_2, addr.admin_area_1].filter(Boolean).join(", ") || null : null,
    carrier: r.tracking?.carrier ?? null,
    trackingNumber: r.tracking?.trackingNumber ?? null,
    shippedAt: r.tracking?.shippedAt ?? null,
    paypalOrderId: r.paypal_order_id,
    disputeStatus: r.dispute_status,
    disputeReason: r.dispute_reason,
    ageHours: Math.max(0, Math.round((now - Date.parse(createdAt)) / 36e5)),
    simulated: isSimulated(r.paypal_order_id, r.authorization_id),
    demo: Boolean(r.paypal_order_id?.startsWith("DEMO-")),
  };
}

export async function loadOrders(slug: string, opts: { id?: string } = {}): Promise<ConsoleOrder[]> {
  const only = opts.id ? sql`and o.id = ${opts.id}` : sql``;
  const result = await db().execute(sql`
    select o.id, o.status, o.total_cents, o.platform_fee_cents, o.paypal_order_id, o.authorization_id, o.tracking,
           o.created_at, o.updated_at, c.agent_client, c.cart,
           d.status as dispute_status, d.reason as dispute_reason
    from orders o
    join carts c on c.id = o.cart_id
    left join lateral (
      select status, reason from disputes where disputes.order_id = o.id order by updated_at desc limit 1
    ) d on true
    where o.shop_id = ${slug} ${only}
    order by o.created_at desc
    limit 1000
  `);
  const now = Date.now();
  return rows<OrderRowRaw>(result).map((r) => toOrder(r, now));
}

export async function loadOrder(slug: string, id: string): Promise<ConsoleOrder | null> {
  return (await loadOrders(slug, { id }))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Negotiations

interface NegotiationRowRaw {
  id: string;
  created_at: Date | string;
  agent_client: string | null;
  variant_id: string;
  transcript: unknown[];
  outcome: string | null;
  final_unit_cents: number | null;
  floor_cents: number | null;
  product_name: string | null;
  variant_name: string | null;
  price_cents: number | null;
}

/** The unit price a turn names: an explicit field, or the first dollar amount no higher than list. */
function unitOf(turn: Record<string, unknown>, listCents: number): number | null {
  for (const key of ["unitCents", "askCents"]) {
    const v = turn[key];
    if (typeof v === "number" && v > 0) return Math.round(v);
  }
  const text = typeof turn.text === "string" ? turn.text : "";
  const amounts = quotedAmounts(text).filter((c) => c > 0 && c <= listCents);
  return amounts[0] ?? null;
}

function toNegotiation(r: NegotiationRowRaw): ConsoleNegotiation {
  const listCents = r.price_cents ?? r.final_unit_cents ?? 0;
  const raw = (Array.isArray(r.transcript) ? r.transcript : []) as Array<Record<string, unknown>>;
  const transcript: ConsoleTurn[] = raw
    .filter((t) => t && (t.from === "buyer" || t.from === "seller"))
    .map((t) => ({ from: t.from as "buyer" | "seller", text: String(t.text ?? ""), unitCents: unitOf(t, listCents) }));
  const buyers = transcript.filter((t) => t.from === "buyer");
  const sellers = transcript.filter((t) => t.from === "seller");
  // The buyer agent's opening ask: where the haggle started.
  const ask = buyers.find((t) => t.unitCents != null)?.unitCents ?? null;
  const answer = sellers.find((t) => t.unitCents != null)?.unitCents ?? r.final_unit_cents;
  const verdict = (["accept", "clamped", "refuse", "none"].includes(r.outcome ?? "") ? r.outcome : "none") as Verdict;
  const final = r.final_unit_cents;
  return {
    id: r.id,
    createdAt: iso(r.created_at),
    agent: r.agent_client,
    agentLabel: agentLabel(r.agent_client),
    agentFamily: agentFamily(r.agent_client),
    variantId: r.variant_id,
    productName: r.product_name ?? r.variant_id,
    variantName: r.variant_name ?? r.variant_id,
    listCents,
    askCents: ask,
    answerCents: answer ?? null,
    finalUnitCents: final,
    floorCents: r.floor_cents,
    verdict,
    discountPct: final != null && listCents > 0 ? Math.round(((listCents - final) / listCents) * 1000) / 10 : null,
    rounds: Math.max(1, buyers.length),
    buyerText: buyers.at(-1)?.text ?? "",
    sellerText: sellers.at(-1)?.text ?? "",
    transcript,
    demo: raw.some((t) => t?.demo === true),
  };
}

export async function loadNegotiations(slug: string, opts: { id?: string } = {}): Promise<ConsoleNegotiation[]> {
  const only = opts.id ? sql`and n.id = ${opts.id}` : sql``;
  const result = await db().execute(sql`
    select n.id, n.created_at, n.agent_client, n.variant_id, n.transcript, n.outcome, n.final_unit_cents, n.floor_cents,
           v.product_name, v.name as variant_name, v.price_cents
    from negotiations n
    left join variants v on v.shop_id = n.shop_id and v.variant_id = n.variant_id
    where n.shop_id = ${slug} ${only}
    order by n.created_at desc
    limit 500
  `);
  return rows<NegotiationRowRaw>(result).map(toNegotiation);
}

// ---------------------------------------------------------------------------
// Catalog

function marketOf(raw: unknown): MarketSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const low = m.lowCents, median = m.medianCents, high = m.highCents;
  if (typeof low !== "number" || typeof median !== "number" || typeof high !== "number") return null;
  const position = m.position === "below" || m.position === "above" ? m.position : "within";
  return {
    lowCents: low,
    medianCents: median,
    highCents: high,
    position,
    checkedAt: typeof m.checkedAt === "string" ? m.checkedAt : new Date(0).toISOString(),
    comparables: Array.isArray(m.comparable) ? m.comparable.length : 0,
    demo: m.demo === true,
  };
}

export function minFloorCents(costCents: number): number {
  return costCents > 0 ? Math.ceil(costCents * 1.25) : 0;
}

export function variantView(v: Variant): ConsoleVariant {
  return {
    id: v.id,
    variantId: v.variantId,
    parentId: v.parentId,
    productName: v.productName,
    name: v.name,
    category: v.category,
    priceCents: v.priceCents,
    costCents: v.costCents,
    floorCents: v.floorCents,
    minFloorCents: minFloorCents(v.costCents),
    stock: v.stock,
    active: v.active,
    purchasable: v.purchasable,
    market: marketOf(v.market),
  };
}

export async function loadCatalog(slug: string): Promise<ConsoleVariant[]> {
  return (await listVariants(db(), slug)).map(variantView);
}

// ---------------------------------------------------------------------------
// Summary

export function aiEnabled(): boolean {
  return Boolean(process.env.VENICE_API_KEY);
}

export async function loadSummary(shop: Shop): Promise<ConsoleSummary> {
  const slug = shop.slug;
  const result = await db().execute(sql`
    select
      (select count(*) from events where shop_id = ${slug} and at > now() - make_interval(days => ${HISTORY_DAYS}))::int as events,
      (select coalesce(max(id), 0) from events where shop_id = ${slug})::bigint as last_event_id,
      (select count(*) from events where shop_id = ${slug} and type = 'cart.created')::int as carts,
      (select count(*) from events where shop_id = ${slug} and type = 'cart.checkout')::int as checkouts,
      (select count(*) from orders where shop_id = ${slug})::int as orders,
      (select count(*) from orders where shop_id = ${slug} and status = 'authorized' and tracking is null)::int as to_ship,
      (select coalesce(sum(total_cents), 0) from orders where shop_id = ${slug} and status in ('authorized', 'captured', 'disputed'))::bigint as gmv,
      (select count(*) from negotiations where shop_id = ${slug})::int as negotiations,
      (select count(*) from disputes where shop_id = ${slug})::int as disputes,
      exists (select 1 from events where shop_id = ${slug} and payload->>'demo' = 'true') as demo
  `);
  const r = rows<Record<string, unknown>>(result)[0] ?? {};
  return {
    shop: shopView(shop),
    generatedAt: new Date().toISOString(),
    lastEventId: Number(r.last_event_id ?? 0),
    includesDemo: r.demo === true,
    aiEnabled: aiEnabled(),
    merchant: false,
    counts: {
      events: Number(r.events ?? 0),
      carts: Number(r.carts ?? 0),
      checkouts: Number(r.checkouts ?? 0),
      orders: Number(r.orders ?? 0),
      toShip: Number(r.to_ship ?? 0),
      negotiations: Number(r.negotiations ?? 0),
      disputes: Number(r.disputes ?? 0),
    },
    gmvCents: Number(r.gmv ?? 0),
  };
}
