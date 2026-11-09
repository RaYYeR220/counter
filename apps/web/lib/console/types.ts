// Shapes the Console API returns. Amounts are integer cents; times are ISO strings.

export type AgentFamily = "perplexity" | "copilot" | "meta" | "counter-mcp" | "storefront" | "other" | "unknown";

export type EventStage = "cart" | "checkout" | "negotiation" | "order" | "payment" | "dispute" | "catalog" | "bench" | "other";

export interface ConsoleShop {
  slug: string;
  name: string;
  owner: string;
  city: string;
  tagline: string;
  orderPrefix: string;
  negotiation: { enabled: boolean; maxDiscountPct: number; bundleMinItems: number };
}

export interface ConsoleEvent {
  id: number;
  at: string;
  type: string;
  stage: EventStage;
  /** Last part of the type: `created`, `accept`, `captured`... */
  outcome: string;
  ref: string | null;
  /** The raw Client_Identifier, when the event names one. */
  agent: string | null;
  agentLabel: string;
  agentFamily: AgentFamily;
  totalCents: number | null;
  ms: number | null;
  /** HTTP status of a Store Sync call, when there was one. */
  http: number | null;
  demo: boolean;
}

export type Fulfilment = "to_ship" | "shipped" | "cancelled" | "refunded" | "disputed";

export interface ConsoleOrderLine {
  variantId: string;
  name: string;
  quantity: number;
  unitCents: number;
}

export interface ConsoleOrder {
  id: string;
  status: "authorized" | "captured" | "voided" | "refunded" | "disputed";
  fulfilment: Fulfilment;
  createdAt: string;
  updatedAt: string;
  totalCents: number;
  platformFeeCents: number | null;
  agent: string | null;
  agentLabel: string;
  agentFamily: AgentFamily;
  items: number;
  lines: ConsoleOrderLine[];
  summary: string;
  shipTo: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  paypalOrderId: string | null;
  disputeStatus: string | null;
  disputeReason: string | null;
  /** Hours since the order was authorized. PayPal holds an authorization for 29 days. */
  ageHours: number;
  /** Seeded demo row or a stubbed-payment bench order: actions skip PayPal. */
  simulated: boolean;
  demo: boolean;
}

export interface ConsoleTurn {
  from: "buyer" | "seller";
  text: string;
  /** The unit price this turn names, in cents, when it names one. */
  unitCents: number | null;
}

export type Verdict = "accept" | "clamped" | "refuse" | "none";

export interface ConsoleNegotiation {
  id: string;
  createdAt: string;
  agent: string | null;
  agentLabel: string;
  agentFamily: AgentFamily;
  variantId: string;
  productName: string;
  variantName: string;
  listCents: number;
  /** What the buyer agent asked for, per unit. */
  askCents: number | null;
  /** The seller agent's first counter, per unit. */
  answerCents: number | null;
  /** The unit price the negotiation ended on. */
  finalUnitCents: number | null;
  floorCents: number | null;
  verdict: Verdict;
  discountPct: number | null;
  rounds: number;
  buyerText: string;
  sellerText: string;
  transcript: ConsoleTurn[];
  demo: boolean;
}

export interface MarketSnapshot {
  lowCents: number;
  medianCents: number;
  highCents: number;
  position: "below" | "within" | "above";
  checkedAt: string;
  comparables: number;
  demo: boolean;
}

export interface ConsoleVariant {
  id: string;
  variantId: string;
  parentId: string;
  productName: string;
  name: string;
  category: string;
  priceCents: number;
  costCents: number;
  floorCents: number;
  /** Lowest floor the shop allows: cost × 1.25, rounded up to a cent. */
  minFloorCents: number;
  stock: number;
  active: boolean;
  purchasable: boolean;
  market: MarketSnapshot | null;
}

export interface ConsoleSummary {
  shop: ConsoleShop;
  generatedAt: string;
  lastEventId: number;
  includesDemo: boolean;
  aiEnabled: boolean;
  /** This request holds a merchant session for the shop. */
  merchant: boolean;
  counts: {
    events: number;
    carts: number;
    checkouts: number;
    orders: number;
    toShip: number;
    negotiations: number;
    disputes: number;
  };
  gmvCents: number;
}

export type ConsoleAction =
  | { kind: "ship"; orderId: string; carrier: string; trackingNumber: string }
  | { kind: "cancel"; orderId: string; reason?: string }
  | { kind: "refund"; orderId: string; amountCents?: number }
  | { kind: "set_floor"; variantId: string; floorCents: number }
  | { kind: "market_check"; variantIds: string[] };

export interface ConsoleActionResult {
  ok: boolean;
  message: string;
  order?: ConsoleOrder;
  variant?: ConsoleVariant;
  variants?: ConsoleVariant[];
  /** The action changed state without calling PayPal (seeded demo or stubbed bench order). */
  simulated?: boolean;
}
