import type { CartView, CheckoutOutcome, ProductDetail, ProductHit, ShopSummary } from "@counter/gateway";

/** One tool call as `POST /api/playground` streams it. */
export interface StepView {
  index: number;
  tool: string;
  args: unknown;
  ok: boolean;
  ms: number;
  text: string;
  structured: unknown;
}

export type PlaygroundEvent =
  | { type: "start"; model: string }
  | { type: "step"; step: StepView }
  | { type: "final"; text: string; stoppedBy: string; steps: number; costUsd: number }
  | { type: "error"; message: string };

export interface RunFinal {
  text: string;
  stoppedBy: string;
  steps: number;
  costUsd: number;
}

/** One message from the person and everything the buyer agent did about it. */
export interface Run {
  id: number;
  prompt: string;
  model?: string;
  steps: StepView[];
  final?: RunFinal;
  /** Why the run ended without an answer, in a plain sentence. */
  problem?: string;
  state: "running" | "done" | "failed" | "stopped";
}

/** Server-side settings the page reads at request time. */
export interface PlaygroundConfig {
  /** PayPal credentials are set on this deployment, so carts get real sandbox orders. */
  paymentsConnected: boolean;
  /** The PayPal sandbox buyer account visitors approve payments with. */
  buyer: { email: string; password: string } | null;
  /** Counter's MCP endpoint, for connecting another agent. */
  mcpUrl: string;
}

/** A Store Sync validation issue, as much of it as the trace shows. */
export interface IssueLike {
  code?: string | null;
  user_message?: string | null;
  message?: string | null;
  variant_id?: string | null;
}

export interface ToolError {
  status?: number;
  name?: string;
  message?: string;
  debug_id?: string;
  issues?: IssueLike[];
  details?: Array<{ field?: string; issue?: string; description?: string }>;
}

export interface NegotiationView {
  shop: string;
  reply: string;
  verdict: "accept" | "clamped" | "refuse" | "none";
  offer?: {
    offer_id: string;
    lines: Array<{ variant_id: string; quantity: number; unit_price: string; list_price: string }>;
    discount: string;
    expires_at: string;
  };
  unknown_items?: string[];
}

export interface OrderStatusView {
  shop: string;
  cart_id: string;
  cart_status: string;
  paypal_order_id: string | null;
  payment_status: string;
  approve_url?: string;
  order_number?: string;
  order_review_page?: string;
  message: string;
  cart: CartView;
}

export type { CartView, CheckoutOutcome, ProductDetail, ProductHit, ShopSummary };
