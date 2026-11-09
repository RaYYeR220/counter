// Shapes the landing page's build-time data takes on its way to the client components.

export type VariantFlag = "" | "seconds" | "made_to_order";

/** One of the demo shop's variants, as the hero draws it. */
export interface Variant {
  id: string;
  /** The product (parent) id; variants of one product sit together in the cluster. */
  product: string;
  /** The shop's glaze name, which picks the dot's colour. */
  glaze: string;
  /** Size or set size, empty when the product has only a glaze. */
  size: string;
  price: string;
  stock: number;
  flag: VariantFlag;
  /** Calendar days of making before the piece can be packed. */
  lead: number;
}

/** A scripted agent trip on the hero. */
export interface HeroTrip {
  /** The agent surface, as Store Sync's Client_Identifier names it. */
  agent: string;
  side: "L" | "R";
  lane: 0 | 1;
  sku: string;
  ask: string;
  /** Wording after the price: " each", " for the pair". */
  per?: string;
  /** A deal the seller agent agreed to in the negotiation benchmark. */
  deal?: { unit: string; qty: number };
  /** A sold-out ask: the two variants the shop offers instead, and the one the buyer picks. */
  honest?: { alts: [string, string]; pick: string };
}

export interface HeroData {
  shop: string;
  /** First name of the person who ships, for "held until … ships". */
  shipper: string;
  variants: Variant[];
  /** Product names by product id. */
  names: Record<string, string>;
  /** Business days the shop takes to hand an order over. */
  handlingDays: number;
  /** Business days of Standard shipping. */
  transitDays: number;
  trips: HeroTrip[];
}

export interface PurchaseArm {
  runs: number;
  correct: number;
  wrongBuys: number;
  missedBuys: number;
  medianSteps: number;
  costUsd: number;
  /** Tool calls per task, in task order. */
  steps: number[];
  /** Whether each task was answered correctly, in task order. */
  correctByTask: boolean[];
}

export interface PurchaseModel {
  id: string;
  label: string;
  storefront: PurchaseArm;
  counter: PurchaseArm;
}

export interface NegotiationLine {
  qty: number;
  product: string;
  attrs: string;
  list: string;
  unit: string;
}

/** One negotiation benchmark run, engine arm. */
export interface NegotiationRun {
  scenario: string;
  category: string;
  shop: string;
  /** Index into the models list. */
  model: number;
  buyer: string;
  reply: string;
  lines: NegotiationLine[];
  discountPct: number;
  /** Set when the engine clamped the seller's first proposal. */
  stopped: string | null;
}
