// The Console's built-in report: Agents, Negotiations, Orders and Catalog
// pages, plus a standalone order book page. Positions are on Studio's
// 24-column canvas grid, in rows of `studioCanvasRowHeight`.

import type { AgReportState, AgWidgetLayoutState } from "ag-studio";
import type { ConsoleRegistry } from "./registry";

export const PAGES = [
  { id: "agents", title: "Agents" },
  { id: "negotiations", title: "Negotiations" },
  { id: "orders", title: "Orders" },
  { id: "catalog", title: "Catalog" },
] as const;

export type PageId = (typeof PAGES)[number]["id"] | "order-book";

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });

const title = (text: string, subtitle?: string) => ({
  title: { enabled: true, text },
  ...(subtitle ? { subtitle: { enabled: true, text: subtitle } } : {}),
});

type Agg = "sum" | "avg" | "min" | "max" | "count" | "countd";
const f = (id: string, aggregation?: Agg) => (aggregation ? { id, aggregation } : { id });

const kpi = (text: string, value: { id: string; aggregation?: Agg }, caption?: string, sparklineX?: string) => ({
  type: "value" as const,
  dataMapping: { value: [value], ...(sparklineX ? { sparklineX: [{ id: sparklineX }] } : {}) },
  format: {
    title: { enabled: true, text, typography: { fontSize: 13, fontWeight: "normal" as const } },
    caption: { enabled: Boolean(caption), text: caption ?? "" },
    style: { typography: { fontSize: 26, fontWeight: "bold" as const } },
  },
});

const grid = (text: string, cols: string[], subtitle?: string, opts: { crossFilter?: boolean } = {}) => ({
  type: "grid" as const,
  dataMapping: { cols: cols.map((id) => ({ id })) },
  // Order tables open the order on click instead of filtering the page to it.
  format: { ...title(text, subtitle), ...(opts.crossFilter === false ? { triggerCrossFilter: false } : {}) },
});

const legend = { style: { theme: { common: { legend: { enabled: true, position: "bottom" } } } } };

const buttons = (field: string) => ({
  type: "button-filter" as const,
  dataMapping: { value: [f(field)] },
  format: {
    title: { enabled: false },
    style: {
      selection: { type: "multiple" as const },
      dimensions: { minWidth: 96, height: 28 },
      defaultItem: { borderEnabled: true, borderRadius: 7, borderWidth: 1, borderColor: "var(--cx-line-strong)", backgroundColor: "var(--cx-surface)", color: "var(--cx-ink-2)" },
      activeItem: { backgroundColor: "var(--cx-accent-soft)", color: "var(--cx-accent)", borderColor: "var(--cx-accent)" },
    },
  },
});

export function initialReport(): AgReportState<ConsoleRegistry> {
  return {
    selectedPageId: "agents",
    panels: { filters: { collapsed: true }, edit: { collapsed: true }, data: { collapsed: true } },
    pages: [
      {
        id: "agents",
        widgets: {
          "agent-filter": buttons("events.agent"),
          "kpi-requests": kpi("Agent requests", f("events.requests", "sum"), "cart calls and negotiations, 30 days", "calendar::day"),
          "kpi-carts": kpi("Carts created", f("events.carts", "sum"), undefined, "calendar::day"),
          "kpi-orders": kpi("Orders authorized", f("events.orders", "sum"), undefined, "calendar::day"),
          "kpi-rate": kpi("Cart to order", f("checkoutRate"), "authorized orders per cart"),
          "requests-by-day": {
            type: "column-chart-stacked",
            dataMapping: {
              categoryKey: [f("calendar::day")],
              valueKey: [f("events.requests", "sum")],
              legendKey: [f("events.agent")],
            },
            format: { ...title("Requests by agent", "Store Sync cart calls and negotiations per day"), ...legend },
          },
          funnel: {
            type: "funnel-chart",
            dataMapping: { categoryKey: [f("funnel.step")], valueKey: [f("funnel.count", "sum")] },
            format: title("From cart to shipment", "Last 30 days"),
          },
          stream: {
            type: "agent-stream",
            dataMapping: {
              time: [f("events.at")],
              agent: [f("events.agent")],
              event: [f("events.event")],
              amount: [f("events.total")],
              reference: [f("events.ref")],
              latency: [f("events.ms")],
            },
            format: { ...title("Agent stream", "Live; click an agent to filter the page"), style: { maxRows: 60, showLatency: true } },
          },
          latency: {
            type: "box-plot-chart",
            dataMapping: { categoryKey: [f("events.agent")], valueKey: [f("events.ms")] },
            format: title("Store Sync latency", "Server time per call, ms"),
          },
          "orders-by-agent": {
            type: "donut-chart",
            dataMapping: { categoryKey: [f("events.agent")], valueKey: [f("events.orders", "sum")] },
            format: { ...title("Orders by agent"), ...legend },
          },
        },
        widgetLayout: {
          "agent-filter": at(0, 0, 24, 5),
          "kpi-requests": at(0, 5, 6, 7),
          "kpi-carts": at(6, 5, 6, 7),
          "kpi-orders": at(12, 5, 6, 7),
          "kpi-rate": at(18, 5, 6, 7),
          stream: at(0, 12, 14, 30),
          "requests-by-day": at(14, 12, 10, 15),
          funnel: at(14, 27, 10, 15),
          latency: at(0, 42, 14, 15),
          "orders-by-agent": at(14, 42, 10, 15),
        },
        filter: {
          widget: {
            "requests-by-day": [{ field: f("events.requests"), model: { operator: "greaterThan", value: 0 } }],
            latency: [
              { field: f("events.ms"), model: { operator: "isNotBlank" } },
              { field: f("events.stage"), model: { operator: "isIn", value: ["cart", "checkout"] } },
            ],
            "orders-by-agent": [{ field: f("events.orders"), model: { operator: "greaterThan", value: 0 } }],
          },
        },
      },
      {
        id: "negotiations",
        widgets: {
          "kpi-negotiations": kpi("Negotiations", f("negotiations.id", "count"), "buyer agents asking for a better price"),
          "kpi-accepted": kpi("Accepted as asked", f("acceptRate"), "no counter needed"),
          "kpi-discount": kpi("Average discount", f("negotiations.discountPct", "avg"), "below list, when a deal was made"),
          "kpi-below": kpi("Deals below your floor", f("negotiations.belowFloor", "sum"), "the pricing engine refuses them"),
          ladder: {
            type: "floor-ladder",
            dataMapping: {
              label: [f("negotiations.item")],
              list: [f("negotiations.list")],
              ask: [f("negotiations.ask")],
              answer: [f("negotiations.answer")],
              final: [f("negotiations.final")],
              floor: [f("negotiations.floor")],
              verdict: [f("negotiations.verdict")],
              agent: [f("negotiations.agent")],
              time: [f("negotiations.createdAt")],
              id: [f("negotiations.id")],
            },
            format: { ...title("Floor ladder", "Latest negotiations; right-click one for its transcript"), style: { maxRows: 14, showFloorValue: true } },
          },
          verdicts: {
            type: "donut-chart",
            dataMapping: { categoryKey: [f("negotiations.verdict")], valueKey: [f("negotiations.id", "count")] },
            format: { ...title("How negotiations ended"), ...legend },
          },
          "discount-by-agent": {
            type: "bar-chart-grouped",
            dataMapping: { categoryKey: [f("negotiations.agent")], valueKey: [f("negotiations.discountPct", "avg")] },
            format: title("Average discount by agent"),
          },
          "negotiation-grid": grid(
            "All negotiations",
            [
              "negotiations.createdAt",
              "negotiations.agent",
              "negotiations.item",
              "negotiations.list",
              "negotiations.ask",
              "negotiations.answer",
              "negotiations.final",
              "negotiations.floor",
              "negotiations.verdict",
              "negotiations.discountPct",
              "negotiations.rounds",
            ],
            "Floors are shown here only; buyer agents never see them",
          ),
        },
        widgetLayout: {
          "kpi-negotiations": at(0, 0, 6, 7),
          "kpi-accepted": at(6, 0, 6, 7),
          "kpi-discount": at(12, 0, 6, 7),
          "kpi-below": at(18, 0, 6, 7),
          ladder: at(0, 7, 15, 34),
          verdicts: at(15, 7, 9, 17),
          "discount-by-agent": at(15, 24, 9, 17),
          "negotiation-grid": at(0, 41, 24, 22),
        },
      },
      {
        id: "orders",
        widgets: {
          "kpi-to-ship": kpi("To ship", f("orders.toShip", "sum"), "payment authorized, waiting on you"),
          "kpi-held": kpi("Authorized, not captured", f("orders.held", "sum"), "captured when you ship"),
          "kpi-captured": kpi("Captured", f("orders.captured", "sum"), "shipped and paid"),
          "kpi-orders": kpi("Orders", f("orders.id", "count"), "from agent checkouts"),
          "status-filter": buttons("orders.fulfilment"),
          "order-grid": grid(
            "Orders",
            [
              "orders.id",
              "orders.createdAt",
              "orders.agent",
              "orders.summary",
              "orders.total",
              "orders.fulfilment",
              "orders.nextStep",
              "orders.shipTo",
              "orders.carrier",
              "orders.trackingNumber",
              "orders.ageHours",
            ],
            "Click an order for details; right-click for actions",
            { crossFilter: false },
          ),
        },
        widgetLayout: {
          "kpi-to-ship": at(0, 0, 6, 7),
          "kpi-held": at(6, 0, 6, 7),
          "kpi-captured": at(12, 0, 6, 7),
          "kpi-orders": at(18, 0, 6, 7),
          "status-filter": at(0, 7, 24, 5),
          "order-grid": at(0, 12, 24, 34),
        },
      },
      {
        id: "catalog",
        widgets: {
          "kpi-variants": kpi("Variants", f("variants.variantId", "count")),
          "kpi-low": kpi("Low stock", f("variants.lowStock", "sum"), "3 or fewer left"),
          "kpi-above": kpi("Above market", f("variants.aboveMarket", "sum"), "priced over other sellers' range"),
          "kpi-vs-median": kpi("Price vs market median", f("variants.vsMedian", "avg"), "average across checked variants"),
          market: {
            type: "market-position",
            dataMapping: {
              label: [f("variants.product")],
              price: [f("variants.price", "avg")],
              low: [f("variants.marketLow", "avg")],
              median: [f("variants.marketMedian", "avg")],
              high: [f("variants.marketHigh", "avg")],
              floor: [f("variants.floor", "min")],
            },
            format: { ...title("Market position", "Your price against other sellers (Channel3); right-click to re-check"), style: { maxRows: 20 } },
          },
          "variant-grid": grid("Variants", [
            "variants.item",
            "variants.stock",
            "variants.price",
            "variants.floor",
            "variants.minFloor",
            "variants.position",
            "variants.vsMedian",
          ]),
        },
        widgetLayout: {
          "kpi-variants": at(0, 0, 6, 7),
          "kpi-low": at(6, 0, 6, 7),
          "kpi-above": at(12, 0, 6, 7),
          "kpi-vs-median": at(18, 0, 6, 7),
          market: at(0, 7, 12, 36),
          "variant-grid": at(12, 7, 12, 36),
        },
      },
      {
        id: "order-book",
        layout: { type: "standalone" },
        widgets: {
          "order-book-grid": grid("Order book", [
            "orders.id",
            "orders.createdAt",
            "orders.agent",
            "orders.summary",
            "orders.items",
            "orders.total",
            "orders.status",
            "orders.fulfilment",
            "orders.nextStep",
            "orders.shipTo",
            "orders.carrier",
            "orders.trackingNumber",
            "orders.ageHours",
          ], undefined, { crossFilter: false }),
        },
      },
    ],
  } as unknown as AgReportState<ConsoleRegistry>;
}
