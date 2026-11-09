// The Console's data model for AG Studio: five tables built from the Console
// API, with descriptions the assistant reads. Every table accepts live-data
// transactions, so new activity lands in place without reloading Studio.

import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from "ag-studio";
import type { ConsoleEvent, ConsoleNegotiation, ConsoleOrder, ConsoleVariant } from "../types";
import type { ConsoleRegistry } from "./registry";

export const CALENDAR_ID = "calendar";

const dollars = (cents: number | null | undefined) => (cents == null ? null : Math.round(cents) / 100);
const day = (iso: string) => iso.slice(0, 10);

type FieldSpec = [id: string, name: string, format: AgFormat<ConsoleRegistry>, description?: string, hide?: boolean];

// Display formats, so money reads $34.00 and times read "Nov 9, 7:12 AM" everywhere Studio shows them.
const FORMAT_OPTIONS: Partial<Record<string, { format: Intl.NumberFormat | Intl.DateTimeFormat }>> = {
  currencyFormat: { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) },
  percentageFormat: { format: new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }) },
  dateTimeFormat: { format: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) },
  dateFormat: { format: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }) },
};

const fields = (specs: FieldSpec[]): AgFieldDefinition<ConsoleRegistry>[] =>
  specs.map(([id, name, format, description, hide]) => ({
    id,
    name,
    format,
    ...(FORMAT_OPTIONS[format] ? { formatOptions: FORMAT_OPTIONS[format] } : {}),
    ...(description ? { description } : {}),
    ...(hide ? { hide } : {}),
  }));

// ---------------------------------------------------------------------------
// Rows

const EVENT_NAMES: Record<string, string> = {
  "cart.created": "Cart created",
  "cart.updated": "Cart updated",
  "cart.checkout": "Checkout",
  "order.authorized": "Order authorized",
  "order.captured": "Payment captured",
  "order.shipped": "Shipped",
  "order.voided": "Order cancelled",
  "order.refunded": "Refunded",
  "order.capture_declined": "Capture declined",
  "negotiation.accept": "Offer accepted",
  "negotiation.clamped": "Countered at the floor",
  "negotiation.refuse": "Offer refused",
  "negotiation.none": "Asked about price",
  "bench.checkout": "Benchmark checkout",
  "catalog.published": "Catalog published",
  "catalog.floor_changed": "Floor changed",
  "dispute.evidence_submitted": "Dispute evidence sent",
  "dispute.accepted": "Dispute accepted",
};

export function eventName(type: string): string {
  return EVENT_NAMES[type] ?? type.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

const AGENT_REQUESTS = new Set(["cart.created", "cart.updated", "cart.checkout"]);

export interface EventRow {
  id: number;
  at: string;
  day: string;
  type: string;
  event: string;
  stage: string;
  outcome: string;
  agent: string;
  ref: string | null;
  total: number | null;
  ms: number | null;
  requests: number;
  carts: number;
  checkouts: number;
  orders: number;
  shipped: number;
  failed: number;
  demo: boolean;
}

export function eventRow(e: ConsoleEvent): EventRow {
  return {
    id: e.id,
    at: e.at,
    day: day(e.at),
    type: e.type,
    event: eventName(e.type),
    stage: e.stage,
    outcome: e.outcome,
    agent: e.agentLabel,
    ref: e.ref,
    total: dollars(e.totalCents),
    ms: e.ms,
    requests: AGENT_REQUESTS.has(e.type) || e.stage === "negotiation" ? 1 : 0,
    carts: e.type === "cart.created" ? 1 : 0,
    checkouts: e.type === "cart.checkout" ? 1 : 0,
    orders: e.type === "order.authorized" ? 1 : 0,
    shipped: e.type === "order.shipped" ? 1 : 0,
    failed: e.http != null && e.http >= 400 ? 1 : 0,
    demo: e.demo,
  };
}

export interface FunnelRow {
  step: string;
  position: number;
  count: number;
}

const FUNNEL: Array<[string, (e: EventRow) => number]> = [
  ["Carts created", (e) => e.carts],
  ["Checkouts", (e) => e.checkouts],
  ["Orders authorized", (e) => e.orders],
  ["Shipped", (e) => e.shipped],
];

export function funnelRows(events: EventRow[]): FunnelRow[] {
  return FUNNEL.map(([step, pick], i) => ({ step, position: i + 1, count: events.reduce((s, e) => s + pick(e), 0) }));
}

export interface OrderRow {
  id: string;
  createdAt: string;
  day: string;
  status: string;
  fulfilment: string;
  nextStep: string;
  agent: string;
  total: number;
  items: number;
  summary: string;
  shipTo: string;
  carrier: string;
  trackingNumber: string;
  ageHours: number;
  toShip: number;
  held: number;
  captured: number;
  demo: boolean;
}

const NEXT_STEP: Record<ConsoleOrder["fulfilment"], string> = {
  to_ship: "Ship",
  shipped: "Refund",
  cancelled: "Closed",
  refunded: "Closed",
  disputed: "Respond",
};

const FULFILMENT_LABEL: Record<ConsoleOrder["fulfilment"], string> = {
  to_ship: "To ship",
  shipped: "Shipped",
  cancelled: "Cancelled",
  refunded: "Refunded",
  disputed: "Disputed",
};

export function orderRow(o: ConsoleOrder): OrderRow {
  return {
    id: o.id,
    createdAt: o.createdAt,
    day: day(o.createdAt),
    status: o.status,
    fulfilment: FULFILMENT_LABEL[o.fulfilment],
    nextStep: NEXT_STEP[o.fulfilment],
    agent: o.agentLabel,
    total: dollars(o.totalCents) ?? 0,
    items: o.items,
    summary: o.summary,
    shipTo: o.shipTo ?? "",
    carrier: o.carrier ?? "",
    trackingNumber: o.trackingNumber ?? "",
    ageHours: o.ageHours,
    toShip: o.fulfilment === "to_ship" ? 1 : 0,
    held: o.status === "authorized" ? (dollars(o.totalCents) ?? 0) : 0,
    captured: o.status === "captured" || o.status === "disputed" ? (dollars(o.totalCents) ?? 0) : 0,
    demo: o.demo,
  };
}

export interface NegotiationRow {
  id: string;
  createdAt: string;
  day: string;
  agent: string;
  variantId: string;
  product: string;
  item: string;
  list: number;
  ask: number | null;
  answer: number | null;
  final: number | null;
  floor: number | null;
  headroom: number | null;
  verdict: string;
  discountPct: number | null;
  accepted: number;
  belowFloor: number;
  rounds: number;
  buyer: string;
  seller: string;
  demo: boolean;
}

const VERDICT_LABEL: Record<ConsoleNegotiation["verdict"], string> = {
  accept: "Accepted",
  clamped: "Countered",
  refuse: "Refused",
  none: "No offer",
};

export function negotiationRow(n: ConsoleNegotiation): NegotiationRow {
  return {
    id: n.id,
    createdAt: n.createdAt,
    day: day(n.createdAt),
    agent: n.agentLabel,
    variantId: n.variantId,
    product: n.productName,
    item: n.variantName,
    list: dollars(n.listCents) ?? 0,
    ask: dollars(n.askCents),
    answer: dollars(n.answerCents),
    final: dollars(n.finalUnitCents),
    floor: dollars(n.floorCents),
    headroom: n.finalUnitCents != null && n.floorCents != null ? dollars(n.finalUnitCents - n.floorCents) : null,
    verdict: VERDICT_LABEL[n.verdict],
    discountPct: n.discountPct == null ? null : n.discountPct / 100,
    accepted: n.verdict === "accept" ? 1 : 0,
    belowFloor: n.finalUnitCents != null && n.floorCents != null && n.finalUnitCents < n.floorCents ? 1 : 0,
    rounds: n.rounds,
    buyer: n.buyerText,
    seller: n.sellerText,
    demo: n.demo,
  };
}

export interface VariantRow {
  variantId: string;
  product: string;
  item: string;
  category: string;
  price: number;
  cost: number;
  floor: number;
  minFloor: number;
  stock: number;
  marketLow: number | null;
  marketMedian: number | null;
  marketHigh: number | null;
  position: string;
  vsMedian: number | null;
  checkedAt: string | null;
  lowStock: number;
  aboveMarket: number;
}

const POSITION_LABEL = { below: "Below market", within: "In range", above: "Above market" } as const;

export function variantRow(v: ConsoleVariant): VariantRow {
  const m = v.market;
  return {
    variantId: v.variantId,
    product: v.productName,
    item: v.name,
    category: v.category,
    price: dollars(v.priceCents) ?? 0,
    cost: dollars(v.costCents) ?? 0,
    floor: dollars(v.floorCents) ?? 0,
    minFloor: dollars(v.minFloorCents) ?? 0,
    stock: v.stock,
    marketLow: m ? dollars(m.lowCents) : null,
    marketMedian: m ? dollars(m.medianCents) : null,
    marketHigh: m ? dollars(m.highCents) : null,
    position: m ? POSITION_LABEL[m.position] : "Not checked",
    vsMedian: m && m.medianCents > 0 ? (v.priceCents - m.medianCents) / m.medianCents : null,
    checkedAt: m ? day(m.checkedAt) : null,
    lowStock: v.active && v.stock <= 3 ? 1 : 0,
    aboveMarket: m?.position === "above" ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Sources

export interface ConsoleSnapshot {
  shopName: string;
  events: ConsoleEvent[];
  orders: ConsoleOrder[];
  negotiations: ConsoleNegotiation[];
  variants: ConsoleVariant[];
}

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split(".") as [string, string];
  const [targetTable, targetField] = target.split(".") as [string, string];
  return {
    id,
    source: { tableId: sourceTable, fieldId: sourceField },
    target: { tableId: targetTable, fieldId: targetField },
    type: "many-to-one",
  };
};

const onCalendar = (tableId: string, fieldId: string): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
  truncate: "day",
});

export function buildStudioData(s: ConsoleSnapshot): AgDataSourcesDefinition<ConsoleRegistry> {
  const events = s.events.map(eventRow);
  const today = new Date().toISOString().slice(0, 10);
  const days = [...events.map((e) => e.day), ...s.orders.map((o) => day(o.createdAt))].sort();
  const from = days[0] ?? today;

  return {
    description:
      `Activity of ${s.shopName}, a small shop that sells to AI shopping agents through PayPal's Store Sync Cart API. ` +
      "Agents (Perplexity, Copilot, Meta AI, Counter MCP) build carts and check out; the shop's own storefront appears as Storefront. " +
      "Checkout only authorizes the buyer's PayPal payment: the money is captured when the shop ships, and cancelling releases the hold. " +
      "A seller agent haggles with buyer agents but can never go below each item's floor. Money fields are in USD.",
    sources: [
      {
        id: "events",
        name: "Agent activity",
        description:
          "One row per thing that happened at the shop in the last 30 days: Store Sync cart calls from agents, negotiations, order and payment changes. " +
          "Sum the 0/1 counters (Agent requests, Carts, Checkouts, Orders, Shipped) rather than counting rows.",
        transactions: "add",
        data: events,
        fields: fields([
          ["id", "Event ID", "integerFormat", "Increasing id; newer events have higher ids.", true],
          ["at", "Time", "dateTimeFormat"],
          ["day", "Day", "dateFormat", "Calendar day of the event.", true],
          ["type", "Event type", "textFormat", "Machine name, e.g. cart.created, negotiation.accept, order.shipped."],
          ["event", "Event", "textFormat", "What happened, in words."],
          ["stage", "Stage", "textFormat", "cart, checkout, negotiation, order, payment, dispute, catalog or bench."],
          ["outcome", "Outcome", "textFormat"],
          ["agent", "Agent", "textFormat", "The agent surface the request came from (PayPal Client_Identifier)."],
          ["ref", "Reference", "textFormat", "Cart, order or offer id the event is about."],
          ["total", "Cart total", "currencyFormat", "Cart or order total in USD at the time of the event."],
          ["ms", "Latency (ms)", "integerFormat", "How long the Store Sync call took on the server, in milliseconds."],
          ["requests", "Agent requests", "integerFormat", "1 for every cart call or negotiation an agent made."],
          ["carts", "Carts", "integerFormat", "1 when an agent created a cart."],
          ["checkouts", "Checkouts", "integerFormat", "1 when an agent checked a cart out."],
          ["orders", "Orders", "integerFormat", "1 when a checkout produced an authorized order."],
          ["shipped", "Shipped", "integerFormat", "1 when the shop shipped an order."],
          ["failed", "Failed calls", "integerFormat", "1 when a Store Sync call answered with an HTTP error."],
          ["demo", "Demo row", "booleanFormat", "True for seeded demo activity.", true],
        ]),
      },
      {
        id: "funnel",
        name: "Order funnel",
        description: "Carts created, checkouts, authorized orders and shipments over the last 30 days, one row per step, in order.",
        transactions: "all",
        primaryKeyField: "step",
        data: funnelRows(events),
        fields: fields([
          ["step", "Step", "textFormat"],
          ["position", "Position", "integerFormat", "1 for the first step.", true],
          ["count", "Count", "integerFormat"],
        ]),
      },
      {
        id: "orders",
        name: "Orders",
        description:
          "Orders booked from agent checkouts. 'To ship' orders hold an authorized payment that is captured when the shop ships. " +
          "Age is hours since checkout; PayPal keeps an authorization for 29 days.",
        transactions: "all",
        primaryKeyField: "id",
        data: s.orders.map(orderRow),
        fields: fields([
          ["id", "Order", "textFormat"],
          ["createdAt", "Placed", "dateTimeFormat"],
          ["day", "Order day", "dateFormat", undefined, true],
          ["status", "Payment", "textFormat", "authorized, captured, voided, refunded or disputed."],
          ["fulfilment", "Status", "textFormat", "To ship, Shipped, Cancelled, Refunded or Disputed."],
          ["nextStep", "Next step", "textFormat", "What the shop should do next with this order."],
          ["agent", "Agent", "textFormat"],
          ["total", "Total", "currencyFormat"],
          ["items", "Items", "integerFormat"],
          ["summary", "Contents", "textFormat"],
          ["shipTo", "Ship to", "textFormat"],
          ["carrier", "Carrier", "textFormat"],
          ["trackingNumber", "Tracking", "textFormat"],
          ["ageHours", "Age (h)", "integerFormat"],
          ["toShip", "To ship", "integerFormat", "1 while the order is waiting to be shipped."],
          ["held", "Authorized", "currencyFormat", "Total held on the buyer's PayPal account, captured when the order ships."],
          ["captured", "Captured", "currencyFormat", "Total already captured (shipped orders)."],
          ["demo", "Demo row", "booleanFormat", undefined, true],
        ]),
      },
      {
        id: "negotiations",
        name: "Negotiations",
        description:
          "Price negotiations between buyer agents and the shop's seller agent, one row per item haggled over. " +
          "Ask is the buyer's per-unit ask, Counter the seller's first answer, Final the unit price agreed, Floor the lowest price the shop allows. " +
          "Final is never below Floor.",
        transactions: "all",
        primaryKeyField: "id",
        data: s.negotiations.map(negotiationRow),
        fields: fields([
          ["id", "Negotiation ID", "textFormat", undefined, true],
          ["createdAt", "Time", "dateTimeFormat"],
          ["day", "Negotiation day", "dateFormat", undefined, true],
          ["agent", "Agent", "textFormat"],
          ["variantId", "Variant ID", "textFormat", undefined, true],
          ["product", "Product", "textFormat"],
          ["item", "Item", "textFormat"],
          ["list", "List price", "currencyFormat"],
          ["ask", "Ask", "currencyFormat"],
          ["answer", "Counter", "currencyFormat"],
          ["final", "Final", "currencyFormat"],
          ["floor", "Floor", "currencyFormat"],
          ["headroom", "Above floor", "currencyFormat", "Final minus floor: how much room was left."],
          ["verdict", "Verdict", "textFormat", "Accepted, Countered, Refused or No offer."],
          ["discountPct", "Discount", "percentageFormat", "Final price below list, as a share of list."],
          ["accepted", "Accepted", "integerFormat", "1 when the buyer's ask was accepted as asked."],
          ["belowFloor", "Below floor", "integerFormat", "1 if the agreed price went below the floor. Always 0: the pricing engine refuses those."],
          ["rounds", "Rounds", "integerFormat"],
          ["buyer", "Buyer said", "textFormat"],
          ["seller", "Seller said", "textFormat"],
          ["demo", "Demo row", "booleanFormat", undefined, true],
        ]),
      },
      {
        id: "variants",
        name: "Catalog",
        description:
          "Every variant the shop sells, with price, cost, negotiation floor, stock and the last market check against other sellers (Channel3). " +
          "Min floor is cost × 1.25, the lowest floor the shop allows.",
        transactions: "all",
        primaryKeyField: "variantId",
        data: s.variants.map(variantRow),
        fields: fields([
          ["variantId", "SKU", "textFormat"],
          ["product", "Product", "textFormat"],
          ["item", "Item", "textFormat"],
          ["category", "Category", "textFormat"],
          ["price", "Price", "currencyFormat"],
          ["cost", "Cost", "currencyFormat"],
          ["floor", "Floor", "currencyFormat"],
          ["minFloor", "Min floor", "currencyFormat"],
          ["stock", "Stock", "integerFormat"],
          ["marketLow", "Market low", "currencyFormat", "Lower quartile of comparable listings."],
          ["marketMedian", "Market median", "currencyFormat"],
          ["marketHigh", "Market high", "currencyFormat", "Upper quartile of comparable listings."],
          ["position", "Market position", "textFormat"],
          ["vsMedian", "vs median", "percentageFormat", "Our price against the market median."],
          ["checkedAt", "Checked", "dateFormat"],
          ["lowStock", "Low stock", "integerFormat", "1 when an active variant has 3 or fewer in stock."],
          ["aboveMarket", "Above market", "integerFormat", "1 when our price is above the market's upper quartile."],
        ]),
      },
    ],
    relationships: [
      manyToOne("negotiations-variant", "negotiations.variantId", "variants.variantId"),
      onCalendar("events", "day"),
      onCalendar("orders", "day"),
      onCalendar("negotiations", "day"),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: "Calendar",
        range: { from: { type: "date", value: from }, to: { type: "date", value: today } },
        fragments: ["year", "month", "week", "day", "dayOfWeek"],
      },
    ],
    expressions: [
      {
        id: "acceptRate",
        name: "Accepted as asked",
        description: "Share of negotiations where the buyer agent's ask was accepted without a counter.",
        format: "percentageFormat",
        isMeasure: true,
        expression: { operator: "divide", inputs: [{ id: "negotiations.accepted", aggregation: "sum" }, { id: "negotiations.id", aggregation: "count" }] },
      },
      {
        id: "checkoutRate",
        name: "Cart to order",
        description: "Authorized orders per cart created.",
        format: "percentageFormat",
        isMeasure: true,
        expression: { operator: "divide", inputs: [{ id: "events.orders", aggregation: "sum" }, { id: "events.carts", aggregation: "sum" }] },
      },
    ],
  };
}
