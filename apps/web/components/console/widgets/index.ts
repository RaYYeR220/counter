"use client";

import type { AgCoreDefaultRegistry, AgWidgetsConfig } from "ag-studio";
import { createWidgets, type AgWidgetDefinition } from "ag-studio-react";
import { baseFormat, formatShape, type AgentStreamDef, type ConsoleRegistry, type FloorLadderDef, type MarketPositionDef } from "@/lib/console/studio/registry";
import AgentStream from "./AgentStream";
import { createCellRenderer, getLinkedFields } from "./cells";
import FloorLadder from "./FloorLadder";
import MarketPosition from "./MarketPosition";

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

const agentStream: AgWidgetDefinition<"agent-stream", AgentStreamDef> = {
  id: "agent-stream",
  label: "Agent stream",
  icon: icon('<path d="M4 6h16M4 12h10M4 18h13"/><circle cx="19" cy="12" r="1.5"/>'),
  dataMapping: {
    time: { type: "field", supportedRoles: ["temporal"], required: true, aiDescription: "When the event happened; rows are newest first." },
    agent: { type: "field", supportedRoles: ["category"], required: true, aiDescription: "Which agent made the request." },
    event: { type: "field", supportedRoles: ["category"], required: true, aiDescription: "What happened, in words." },
    amount: { type: "field", supportedRoles: ["numeric"], aiDescription: "Cart or order total." },
    reference: { type: "field", supportedRoles: ["category"], aiDescription: "Cart or order id." },
    latency: { type: "field", supportedRoles: ["numeric"], aiDescription: "Server latency in ms." },
  },
  form: (params) => {
    const form = params.createDefaults({
      dataMappingItems: [
        { key: "time", label: "Time" },
        { key: "agent", label: "Agent" },
        { key: "event", label: "Event" },
        { key: "amount", label: "Amount" },
        { key: "reference", label: "Reference" },
        { key: "latency", label: "Latency" },
      ],
      supportsTriggerCrossFilter: true,
    });
    form.items[1]?.items.push({
      type: "section",
      label: "Stream",
      items: [
        { type: "number", id: "format.style.maxRows", label: "Rows shown", defaultValue: 40 },
        { type: "checkbox", id: "format.style.showLatency", label: "Show latency", defaultValue: true },
      ],
    } as never);
    return form;
  },
  formatShape: formatShape((s) =>
    s.object({
      ...baseFormat(s),
      style: s
        .object({
          maxRows: s.number({ description: "How many of the latest events to list (5 to 200)." }).optional(),
          showLatency: s.boolean({ description: "Show each call's server latency." }).optional(),
        })
        .optional(),
    }),
  ),
  ai: {
    description: "A live ticker of agent activity at the shop, newest first: agent, what happened, cart total and latency.",
    usage: "Use for a live feed of agent requests, carts, checkouts and orders. Map time, agent and event from the Agent activity table.",
  },
  comp: AgentStream,
  defaultSize: { width: 560, height: 480 },
  minSize: { width: 300, height: 220 },
};

const floorLadder: AgWidgetDefinition<"floor-ladder", FloorLadderDef> = {
  id: "floor-ladder",
  label: "Floor ladder",
  icon: icon('<path d="M3 12h18"/><path d="M8 7v10" stroke-width="2"/><circle cx="14" cy="12" r="2.2"/><circle cx="19" cy="12" r="1.2"/>'),
  dataMapping: {
    label: { type: "field", supportedRoles: ["category"], required: true, aiDescription: "What was negotiated, e.g. the item." },
    list: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "List price per unit." },
    ask: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "The buyer agent's ask per unit." },
    answer: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "The seller agent's first counter per unit." },
    final: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "The agreed unit price." },
    floor: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "The shop's floor price per unit." },
    verdict: { type: "field", supportedRoles: ["category"], aiDescription: "Accepted, Countered or Refused." },
    agent: { type: "field", supportedRoles: ["category"], aiDescription: "Buyer agent." },
    time: { type: "field", supportedRoles: ["temporal"], aiDescription: "When it happened; newest first." },
    id: { type: "field", supportedRoles: ["category"], aiDescription: "Negotiation id." },
  },
  form: (params) => {
    const form = params.createDefaults({
      dataMappingItems: [
        { key: "label", label: "Item" },
        { key: "list", label: "List price" },
        { key: "ask", label: "Ask" },
        { key: "answer", label: "Counter" },
        { key: "final", label: "Final" },
        { key: "floor", label: "Floor" },
        { key: "verdict", label: "Verdict" },
        { key: "agent", label: "Agent" },
        { key: "time", label: "Time" },
        { key: "id", label: "Negotiation" },
      ],
      supportsTriggerCrossFilter: true,
    });
    form.items[1]?.items.push({
      type: "section",
      label: "Ladder",
      items: [
        { type: "number", id: "format.style.maxRows", label: "Rows shown", defaultValue: 12 },
        { type: "checkbox", id: "format.style.showFloorValue", label: "Label the floor", defaultValue: true },
      ],
    } as never);
    return form;
  },
  formatShape: formatShape((s) =>
    s.object({
      ...baseFormat(s),
      style: s
        .object({
          maxRows: s.number({ description: "How many negotiations to draw (1 to 100)." }).optional(),
          showFloorValue: s.boolean({ description: "Print the floor price under its line." }).optional(),
        })
        .optional(),
    }),
  ),
  ai: {
    description:
      "Draws each negotiation as a horizontal ladder: list price, buyer ask, seller counter and agreed price, with the shop's floor as a line no deal crosses.",
    usage: "Use to show how negotiations ended against the floor. Map fields from the Negotiations table.",
  },
  comp: FloorLadder,
  defaultSize: { width: 640, height: 520 },
  minSize: { width: 320, height: 240 },
};

const marketPosition: AgWidgetDefinition<"market-position", MarketPositionDef> = {
  id: "market-position",
  label: "Market position",
  icon: icon('<path d="M3 14h18"/><rect x="8" y="11" width="8" height="6" rx="1"/><path d="M12 5v9"/><path d="M10 5h4"/>'),
  dataMapping: {
    label: { type: "field", supportedRoles: ["category"], required: true, aiDescription: "Product." },
    price: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "Our price." },
    low: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "Market low (lower quartile)." },
    median: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "Market median." },
    high: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "Market high (upper quartile)." },
    floor: { type: "field", supportedRoles: ["numeric"], aiDescription: "Our floor." },
  },
  form: (params) => {
    const form = params.createDefaults({
      dataMappingItems: [
        { key: "label", label: "Product" },
        { key: "price", label: "Our price" },
        { key: "low", label: "Market low" },
        { key: "median", label: "Market median" },
        { key: "high", label: "Market high" },
        { key: "floor", label: "Floor" },
      ],
    });
    form.items[1]?.items.push({
      type: "section",
      label: "Instrument",
      items: [{ type: "number", id: "format.style.maxRows", label: "Products shown", defaultValue: 20 }],
    } as never);
    return form;
  },
  formatShape: formatShape((s) =>
    s.object({
      ...baseFormat(s),
      style: s.object({ maxRows: s.number({ description: "How many products to show." }).optional() }).optional(),
    }),
  ),
  ai: {
    description: "For each product, shows our price against the range other sellers charge (Channel3 market check), with the median and our floor.",
    usage: "Use for price positioning. Map fields from the Catalog table, aggregated per product.",
  },
  comp: MarketPosition,
  defaultSize: { width: 560, height: 420 },
  minSize: { width: 300, height: 220 },
};

export const CONSOLE_WIDGET_IDS = ["agent-stream", "floor-ladder", "market-position"] as const;

/** Studio's widget config: the Console's three widgets in their own menu group, and Studio's table with Console cells. */
export function consoleWidgets(defaults: AgWidgetsConfig<AgCoreDefaultRegistry>): AgWidgetsConfig<ConsoleRegistry> {
  return createWidgets<ConsoleRegistry>({
    additionalTypes: [agentStream, floorLadder, marketPosition] as never,
    overrides: [{ id: "grid", options: { createCellRenderer, getLinkedFields } }] as never,
    menu: [{ label: "Shop", widgetIds: [...CONSOLE_WIDGET_IDS] }, ...(defaults.menu as never[])],
  });
}
