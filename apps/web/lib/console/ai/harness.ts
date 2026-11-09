"use client";

import {
  createAiHarness,
  directLlmRunner,
  type AgAiHarnessSetup,
  type AgAiPromptStarter,
  type AgAiTool,
  type AgAnyAiAgentDefinition,
  type AgStudioApi,
} from "ag-studio";
import { consoleBus } from "../bus";
import { consoleApi } from "../client";
import { moneyCents } from "../format";
import type { ConsoleNegotiation, ConsoleShop } from "../types";
import { pendingShipments } from "./pending";
import { openaiAdapter } from "./responses-adapter";

// The Console's agent team: Studio's five built-in agents (lead, planning,
// data, page, widget) with their own prompts and tools, plus `merchant-ops`,
// an agent of the shop's own that works on orders, negotiations, floors and
// market prices through the Console API. The lead is Studio's lead with one
// change: its delegation tool also lists merchant-ops, so a merchant can ask
// one assistant to build a chart and to ship an order in the same thread.

const BUILT_IN_DELEGATES = ["data", "page", "planning", "widget"] as const;

export const MERCHANT_OPS = "merchant-ops";

export const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "What should I ship today?", prompt: "Which orders should I ship today?" },
  { label: "Explain the latest negotiation", prompt: "Explain the most recent negotiation: what the buyer agent asked, what we answered and why." },
  { label: "Check prices against the market", prompt: "Are any of my products priced out of line with other sellers? Re-check the market for the three best sellers." },
  { label: "Chart checkouts by agent", prompt: "Add a chart of checkouts per day by agent to this page." },
];

function describeNegotiation(n: ConsoleNegotiation, maxDiscountPct: number): string {
  const lines = [
    `Negotiation ${n.id} on ${n.createdAt.slice(0, 16).replace("T", " ")} UTC with ${n.agentLabel}, over ${n.variantName}.`,
    `List price ${moneyCents(n.listCents)}. Floor ${moneyCents(n.floorCents)}. Shop policy allows at most ${maxDiscountPct}% off.`,
    `Buyer asked ${moneyCents(n.askCents)} per unit; the seller agent first answered ${moneyCents(n.answerCents)}; it ended at ${moneyCents(n.finalUnitCents)} (${n.discountPct ?? 0}% off list). Verdict: ${n.verdict}.`,
  ];
  if (n.askCents != null && n.floorCents != null && n.askCents < n.floorCents) {
    lines.push("The ask was below the floor, so the pricing engine could not accept it and offered the closest price it allows instead.");
  } else if (n.verdict === "accept") {
    lines.push("The ask was at or above the floor and within the shop's discount policy, so the engine accepted it as asked.");
  } else if (n.verdict === "clamped") {
    lines.push("The ask broke a rule (discount cap, floor or bundle size), so the engine moved it to the nearest deal the rules allow.");
  }
  if (n.finalUnitCents != null && n.floorCents != null) {
    lines.push(`The agreed price is ${moneyCents(n.finalUnitCents - n.floorCents)} above the floor.`);
  }
  lines.push("Transcript:");
  for (const t of n.transcript.slice(-6)) lines.push(`- ${t.from === "buyer" ? n.agentLabel : "Seller agent"}: ${t.text.slice(0, 400)}`);
  return lines.join("\n");
}

function merchantOpsTools(api: AgStudioApi, shop: ConsoleShop): AgAiTool[] {
  const slug = shop.slug;

  const listOrdersToShip = api.defineAiTool({
    name: "list_orders_to_ship",
    description:
      "List orders waiting to be shipped, oldest first. Their payment is authorized and is captured when they ship; authorizations expire after 29 days.",
    params: (s) => s.object({ limit: s.number({ description: "Most orders to return. Defaults to 20." }).optional() }),
    execute: async (args, ctx) => {
      const { orders } = await consoleApi.orders(slug, ctx.signal);
      const due = orders.filter((o) => o.fulfilment === "to_ship").sort((a, b) => b.ageHours - a.ageHours);
      const list = due.slice(0, Math.min(Math.max(args.limit ?? 20, 1), 100));
      if (list.length === 0) return ctx.success("No orders are waiting to be shipped.", { orders: [], total: 0 });
      const lines = list.map(
        (o) =>
          `${o.id}: ${o.summary}; ${moneyCents(o.totalCents)}; from ${o.agentLabel}; ship to ${o.shipTo ?? "address on the order"}; placed ${Math.round(o.ageHours / 24)} days ${o.ageHours % 24} h ago${o.ageHours > 24 * 25 ? " (authorization expires soon)" : ""}`,
      );
      return ctx.success(`${due.length} order(s) to ship, oldest first:\n${lines.join("\n")}`, {
        orders: list.map((o) => ({ id: o.id, summary: o.summary, totalCents: o.totalCents, agent: o.agentLabel, ageHours: o.ageHours, shipTo: o.shipTo })),
        total: due.length,
      });
    },
  });

  const shipOrder = api.defineAiTool({
    name: "ship_order",
    description:
      "Prepare a shipment for the merchant to confirm. Nothing ships and no payment is captured until the merchant presses Confirm on the card this tool shows. Needs the carrier and tracking number from the merchant; never make them up.",
    params: (s) =>
      s.object({
        orderId: s.string({ description: "Order number, e.g. JC-10027." }),
        carrier: s.string({ description: "Carrier name, e.g. USPS, UPS, FedEx." }),
        trackingNumber: s.string({ description: "Tracking number exactly as the merchant gave it." }),
      }),
    execute: async (args, ctx) => {
      const { orders } = await consoleApi.orders(slug, ctx.signal);
      const order = orders.find((o) => o.id.toUpperCase() === args.orderId.trim().toUpperCase());
      if (!order) return ctx.error(`There is no order ${args.orderId}. Use list_orders_to_ship for the open ones.`);
      if (order.fulfilment !== "to_ship") return ctx.error(`${order.id} can't be shipped: it is ${order.fulfilment.replace("_", " ")}.`);
      const pending = pendingShipments.add({
        shop: slug,
        orderId: order.id,
        carrier: args.carrier.trim(),
        trackingNumber: args.trackingNumber.trim(),
        totalCents: order.totalCents,
        summary: order.summary,
      });
      return ctx.success(
        `Shipment for ${order.id} (${args.carrier} ${args.trackingNumber}) is prepared and waiting for the merchant to press Confirm in the chat. It has NOT shipped yet; ${moneyCents(order.totalCents)} will be captured on confirmation.`,
        { pendingId: pending.id, orderId: order.id, carrier: pending.carrier, trackingNumber: pending.trackingNumber, totalCents: order.totalCents, summary: order.summary },
      );
    },
  });

  const explainNegotiation = api.defineAiTool({
    name: "explain_negotiation",
    description:
      "Get the facts of one negotiation: list price, floor, the buyer agent's ask, the seller agent's answer, the final price, the verdict and the transcript. Pass 'latest' for the most recent one.",
    params: (s) => s.object({ negotiationId: s.string({ description: "Negotiation ID from the Negotiations table, or 'latest'." }) }),
    execute: async (args, ctx) => {
      const { negotiations } = await consoleApi.negotiations(slug, ctx.signal);
      const wanted = args.negotiationId.trim();
      const n = wanted.toLowerCase() === "latest" ? negotiations[0] : negotiations.find((x) => x.id === wanted || x.id.startsWith(wanted));
      if (!n) return ctx.error(`No negotiation ${wanted}. Query the Negotiations table for ids, or pass 'latest'.`);
      return ctx.success(describeNegotiation(n, shop.negotiation.maxDiscountPct), { negotiation: n });
    },
  });

  const setFloor = api.defineAiTool({
    name: "set_floor",
    description:
      "Change a variant's floor, the lowest unit price the seller agent may agree to. The shop allows floors from cost × 1.25 up to the list price; anything else is refused.",
    params: (s) =>
      s.object({
        variantId: s.string({ description: "Variant SKU, e.g. JC-MUG-SPECKLE-SAGE-12." }),
        floor: s.number({ description: "New floor per unit, in US dollars." }),
      }),
    execute: async (args, ctx) => {
      const out = await consoleApi.act(slug, { kind: "set_floor", variantId: args.variantId.trim(), floorCents: Math.round(args.floor * 100) }, ctx.signal);
      if (!out.ok) return ctx.error(out.message);
      if (out.variant) consoleBus.send({ kind: "variants-changed", variants: [out.variant] });
      return ctx.success(out.message, { variant: out.variant });
    },
  });

  const marketCheck = api.defineAiTool({
    name: "market_check",
    description: "Re-check what other sellers charge (Channel3) for the given variants and save the result to the catalog. Takes a few seconds per product.",
    params: (s) => s.object({ variantIds: s.array(s.string({ description: "Variant SKU." }), { description: "Up to 10 variant SKUs." }) }),
    execute: async (args, ctx) => {
      const ids = args.variantIds.map((v) => v.trim()).filter(Boolean).slice(0, 10);
      if (ids.length === 0) return ctx.error("Name at least one variant SKU.");
      const out = await consoleApi.act(slug, { kind: "market_check", variantIds: ids }, ctx.signal);
      if (!out.ok) return ctx.error(out.message);
      const variants = out.variants ?? [];
      if (variants.length) consoleBus.send({ kind: "variants-changed", variants });
      const lines = variants.map((v) =>
        v.market
          ? `${v.name}: ours ${moneyCents(v.priceCents)}, market ${moneyCents(v.market.lowCents)}–${moneyCents(v.market.highCents)} (median ${moneyCents(v.market.medianCents)}), ${v.market.position} the range; floor ${moneyCents(v.floorCents)}`
          : `${v.name}: no comparable listings found`,
      );
      return ctx.success(`${out.message}\n${lines.join("\n")}`, { variants });
    },
  });

  return [listOrdersToShip, shipOrder, explainNegotiation, setFloor, marketCheck];
}

export interface ConsoleAiOptions {
  shop: ConsoleShop;
  models: Array<{ id: string; label: string }>;
}

export function buildConsoleAi({ shop, models }: ConsoleAiOptions): AgAiHarnessSetup {
  const adapter = openaiAdapter({ endpoint: "/api/console/ai", model: models[0]?.id, effort: "low" });

  return ({ api }) =>
    createAiHarness(api as unknown as AgStudioApi, ({ builtIn, tools }) => {
      const { studio } = tools;
      const run = (definition: AgAnyAiAgentDefinition, maxTurns: number) => directLlmRunner({ ...definition, adapter, maxTurns });

      const merchantOps = directLlmRunner({
        id: MERCHANT_OPS,
        name: "Merchant ops",
        adapter,
        description:
          "Runs the shop's day-to-day: which orders to ship, preparing shipments for the merchant to confirm, explaining negotiations against floors, changing floors and re-checking market prices. Cannot change the dashboard.",
        schema: (s) => s.undefined(),
        maxTurns: 10,
        instructions: () =>
          [
            `You are Merchant ops for ${shop.name}, ${shop.owner}'s shop in ${shop.city}. You work for the merchant inside their Console.`,
            "How the shop sells: AI agents (Perplexity, Copilot, Meta AI, Counter MCP) buy through PayPal's Store Sync Cart API. Checkout only authorizes the buyer's payment; it is captured when the shop ships, and cancelling releases it. Authorizations last 29 days, so ship the oldest orders first.",
            `A seller agent haggles with buyer agents but can never agree below a variant's floor. Floors must be at least cost × 1.25 and at most the list price. This shop allows at most ${shop.negotiation.maxDiscountPct}% off.`,
            "Use list_orders_to_ship for anything about what to ship. Answer with the order numbers, what is in each and how long it has waited.",
            "ship_order only prepares a shipment. After calling it, tell the merchant to press Confirm on the card in this chat, and that the payment is captured then. Never say an order has shipped. If you don't have a carrier and tracking number from the merchant, ask for them; never invent them.",
            "Use explain_negotiation to explain a negotiation; find ids with execute_query on the Negotiations table when the merchant describes one.",
            "set_floor takes effect immediately; state the old and new floor. market_check re-checks prices against other sellers.",
            "Write short, plain sentences with dollar amounts. No tables unless asked.",
          ].join("\n"),
        tools: () => [studio.viewSchema(), studio.executeQuery(), ...merchantOpsTools(api as unknown as AgStudioApi, shop)],
      });

      // Studio's lead, unchanged except that it can also hand work to merchant-ops.
      const leadDefinition = builtIn.lead;
      const lead = directLlmRunner({
        ...leadDefinition,
        adapter,
        maxTurns: 14,
        tools: (ctx, params) => [
          ...(leadDefinition.tools?.(ctx, params) ?? []).filter((t) => t.name !== "delegate_to"),
          ctx.tools.delegateTo([...BUILT_IN_DELEGATES, MERCHANT_OPS]),
        ],
        instructions: (ctx, params) =>
          [
            leadDefinition.instructions?.(ctx, params) ?? "",
            "",
            `This dashboard is the merchant Console of ${shop.name}. Delegate to merchant-ops anything about orders to ship, shipping, cancelling or refunding orders, negotiations and floors, or market prices: it has the shop's own tools. It cannot change the dashboard, so keep page and widget work with the other agents. When merchant-ops prepares a shipment, pass on that the merchant must press Confirm.`,
          ].join("\n"),
      });

      return {
        agents: [lead, run(builtIn.planning, 8), run(builtIn.data, 10), run(builtIn.page, 12), run(builtIn.widget, 8), merchantOps],
        primary: "lead",
        promptStarters: PROMPT_STARTERS,
        ...(models.length > 1 ? { models: models.map((m) => ({ id: m.id, label: m.label })) } : {}),
      };
    });
}
