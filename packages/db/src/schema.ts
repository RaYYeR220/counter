import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const JWKS_MODES = ["sandbox", "paypal"] as const;
export type JwksMode = (typeof JWKS_MODES)[number];

export const CART_STATUSES = ["CREATED", "INCOMPLETE", "COMPLETED"] as const;

export const ORDER_STATUSES = ["authorized", "captured", "voided", "refunded", "disputed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface NegotiationPolicy {
  enabled: boolean;
  max_discount_pct: number;
  bundle_min_items: number;
}

export interface ShopPolicy {
  returns_days: number;
  ships_from_state: string;
  handling_days: number;
  negotiation: NegotiationPolicy;
}

function inList(column: string, values: readonly string[]) {
  return sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);
}

/**
 * A merchant. A shop's `id` is its slug: every `shop_id` column, and the
 * `shopId` Store Sync passes to the ports, holds the slug.
 */
export const shops = pgTable(
  "shops",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    owner: text("owner").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    tagline: text("tagline").notNull(),
    about: text("about").notNull(),
    paypalMerchantId: text("paypal_merchant_id"),
    onboardingStatus: text("onboarding_status").notNull().default("not_started"),
    jwksMode: text("jwks_mode", { enum: JWKS_MODES }).notNull().default("sandbox"),
    policy: jsonb("policy").$type<ShopPolicy>().notNull(),
    /** Merchant order numbers read `<order_prefix>-<n>`, e.g. JC-10001. */
    orderPrefix: text("order_prefix").notNull(),
    /** Last order number handed out; the next order gets `order_seq + 1`. */
    orderSeq: integer("order_seq").notNull().default(10000),
    createdAt: createdAt(),
  },
  () => [check("shops_jwks_mode_check", inList("jwks_mode", JWKS_MODES))],
);

/** One purchasable variant. `id` is `<shop_id>:<variant_id>`. */
export const variants = pgTable(
  "variants",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    variantId: text("variant_id").notNull(),
    parentId: text("parent_id").notNull(),
    productName: text("product_name").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    url: text("url").notNull(),
    priceCents: integer("price_cents").notNull(),
    costCents: integer("cost_cents").notNull(),
    floorCents: integer("floor_cents").notNull(),
    stock: integer("stock").notNull(),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull(),
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    purchasable: boolean("purchasable").notNull().default(true),
    leadTimeDays: integer("lead_time_days").notNull().default(0),
    weightG: integer("weight_g").notNull(),
    active: boolean("active").notNull().default(true),
    /** Catalog order within the shop, for listings. */
    position: integer("position").notNull().default(0),
    market: jsonb("market"),
  },
  (t) => [unique("variants_shop_variant_unique").on(t.shopId, t.variantId)],
);

export const carts = pgTable(
  "carts",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    status: text("status", { enum: CART_STATUSES }).notNull(),
    cart: jsonb("cart").notNull(),
    paypalOrderId: text("paypal_order_id"),
    lastTotalCents: integer("last_total_cents"),
    completedResponse: jsonb("completed_response"),
    agentClient: text("agent_client"),
    /** Bumped on every write; updates name the version they read. */
    version: integer("version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("carts_shop_idx").on(t.shopId, t.updatedAt.desc()),
    check("carts_status_check", inList("status", CART_STATUSES)),
  ],
);

export interface Tracking {
  carrier: string;
  trackingNumber: string;
  url?: string;
  shippedAt?: string;
}

export const orders = pgTable(
  "orders",
  {
    /** Merchant order number, e.g. JC-10001. */
    id: text("id").primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    cartId: text("cart_id")
      .notNull()
      .unique()
      .references(() => carts.id),
    paypalOrderId: text("paypal_order_id"),
    authorizationId: text("authorization_id"),
    captureId: text("capture_id"),
    payerId: text("payer_id"),
    status: text("status", { enum: ORDER_STATUSES }).notNull(),
    totalCents: integer("total_cents").notNull(),
    /** Set when the payment is captured. */
    platformFeeCents: integer("platform_fee_cents"),
    tracking: jsonb("tracking").$type<Tracking>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_shop_idx").on(t.shopId, t.createdAt.desc()),
    check("orders_status_check", inList("status", ORDER_STATUSES)),
  ],
);

/** Append-only activity log per shop. */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    shopId: text("shop_id").notNull(),
    type: text("type").notNull(),
    ref: text("ref"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_shop_at_idx").on(t.shopId, t.at.desc())],
);

/** A price negotiation between an agent and a shop over one variant. */
export const negotiations = pgTable(
  "negotiations",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    cartId: text("cart_id"),
    agentClient: text("agent_client"),
    variantId: text("variant_id").notNull(),
    transcript: jsonb("transcript").$type<unknown[]>().notNull().default([]),
    outcome: text("outcome"),
    finalUnitCents: integer("final_unit_cents"),
    floorCents: integer("floor_cents"),
    createdAt: createdAt(),
  },
  (t) => [index("negotiations_shop_idx").on(t.shopId, t.createdAt.desc())],
);

/** A PayPal dispute against one of a shop's orders; `id` is PayPal's dispute id. */
export const disputes = pgTable(
  "disputes",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    /** Null until the dispute is matched to one of the shop's orders. */
    orderId: text("order_id"),
    status: text("status").notNull(),
    reason: text("reason"),
    decision: text("decision"),
    evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("disputes_shop_idx").on(t.shopId, t.updatedAt.desc())],
);

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
export type Variant = typeof variants.$inferSelect;
export type NewVariant = typeof variants.$inferInsert;
export type CartRow = typeof carts.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type Negotiation = typeof negotiations.$inferSelect;
export type NewNegotiation = typeof negotiations.$inferInsert;
export type Dispute = typeof disputes.$inferSelect;
export type NewDispute = typeof disputes.$inferInsert;
