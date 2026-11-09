import { DbCartRepo, DbOrderSink, events, getShop, orders, seedCatalog, shops, variants, type Db, type Order } from "@counter/db";
import { createTestDb } from "@counter/db/testing";
import { PayPal, type PayPalEnv } from "@counter/paypal";
import type { CartRecord, OrderSink, PayPalCart } from "@counter/store-sync";
import { and, asc, eq } from "drizzle-orm";
import type { ShopAccounts } from "../src/payments";

export const ENV: PayPalEnv = {
  clientId: "PLATFORM-CLIENT",
  clientSecret: "PLATFORM-SECRET",
  base: "https://api-m.sandbox.paypal.com",
  partnerMerchantId: "PARTNERMID001",
};

/** A PayPal merchant id for an onboarded shop (13 upper-case alphanumerics). */
export const MERCHANT = "SELLERMID0001";

export interface Seen {
  method: string;
  path: string;
  headers: Headers;
  text: string;
  json(): any;
  formData(): Promise<FormData>;
}

type ReplyBody = { status?: number; json?: unknown };
export type Reply = ReplyBody | ((req: Seen) => ReplyBody);

/**
 * In-memory PayPal: routes are matched by `"METHOD /path"` (query ignored) and
 * answered in order; the last reply for a route repeats. Unknown routes answer 404.
 */
export function fakePayPal(routes: Record<string, Reply | Reply[]> = {}) {
  const seen: Seen[] = [];
  const queues = new Map<string, Reply[]>();
  for (const [k, v] of Object.entries(routes)) queues.set(k, Array.isArray(v) ? [...v] : [v]);
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.pathname === "/v1/oauth2/token") {
      return Response.json({ access_token: "A21-token", token_type: "Bearer", expires_in: 32400 });
    }
    const buf = Buffer.from(await req.arrayBuffer());
    const record: Seen = {
      method: req.method,
      path: url.pathname + url.search,
      headers: req.headers,
      text: buf.toString("utf8"),
      json() {
        return JSON.parse(this.text);
      },
      formData() {
        return new Response(buf, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
      },
    };
    seen.push(record);
    const key = `${req.method} ${url.pathname}`;
    const queue = queues.get(key);
    if (!queue?.length) {
      return Response.json({ name: "RESOURCE_NOT_FOUND", message: `no fake route for ${key}` }, { status: 404 });
    }
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    const r = typeof next === "function" ? next(record) : next;
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.json ?? {}), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return {
    client: new PayPal(ENV, fetchImpl),
    calls: () => seen,
    callsTo: (method: string, pathPrefix: string) => seen.filter((s) => s.method === method && s.path.startsWith(pathPrefix)),
  };
}

/** A migrated in-memory database with the demo catalog. */
export async function shopDb(): Promise<Db> {
  const db = await createTestDb();
  await seedCatalog(db, { publicBaseUrl: "https://counter.test" });
  return db;
}

/** Shop accounts read straight from the database (no caching). */
export function dbShopAccounts(db: Db): ShopAccounts {
  return {
    async merchantIdFor(slug) {
      return (await getShop(db, slug))?.paypalMerchantId ?? undefined;
    },
    async brandFor(slug) {
      return (await getShop(db, slug))?.name;
    },
  };
}

export async function onboard(db: Db, slug: string, merchantId = MERCHANT): Promise<void> {
  await db.update(shops).set({ paypalMerchantId: merchantId, onboardingStatus: "active" }).where(eq(shops.id, slug));
}

export interface Line {
  variantId: string;
  parentId: string;
  name: string;
  quantity: number;
  unit: string;
  attributes: Record<string, string>;
}

export const SAGE_12: Line = {
  variantId: "JC-MUG-SPECKLE-SAGE-12",
  parentId: "JC-MUG-SPECKLE",
  name: "Speckled mug — sage, 12 oz",
  quantity: 2,
  unit: "34.00",
  attributes: { glaze: "sage", size: "12 oz" },
};

let cartSeq = 0;

/** A completed Store Sync cart record, as checkout hands it to the order sink. */
export function completedCart(opts: { shopId?: string; lines?: Line[]; payerId?: string; agentClient?: string } = {}): CartRecord {
  const lines = opts.lines ?? [SAGE_12];
  const id = `CART-TEST${String(++cartSeq).padStart(6, "0")}`;
  const money = (v: string) => ({ currency_code: "USD", value: v });
  const subtotal = lines.reduce((s, l) => s + Math.round(Number(l.unit) * 100) * l.quantity, 0);
  const total = subtotal + 599;
  const cart = {
    id,
    status: "COMPLETED",
    validation_status: "VALID",
    validation_issues: [],
    items: lines.map((l) => ({
      variant_id: l.variantId,
      parent_id: l.parentId,
      quantity: l.quantity,
      name: l.name,
      item_url: `https://counter.test/s/juniper-clay/p/${l.parentId}?v=${l.variantId}`,
      price: money(l.unit),
      selected_attributes: Object.entries(l.attributes).map(([name, value]) => ({ name, value })),
    })),
    totals: {
      subtotal: money((subtotal / 100).toFixed(2)),
      shipping: money("5.99"),
      tax: money("0.00"),
      total: money((total / 100).toFixed(2)),
    },
    shipping_address: { address_line_1: "1 Main St", admin_area_2: "Portland", admin_area_1: "OR", postal_code: "97205", country_code: "US" },
    payment_method: { type: "paypal", token: `ORDER-${id}`, payer_id: opts.payerId ?? "PAYER9" },
  } as unknown as PayPalCart;
  const at = new Date("2026-11-01T10:00:00Z");
  return {
    id,
    shopId: opts.shopId ?? "juniper-clay",
    status: "COMPLETED",
    cart,
    paypalOrderId: `ORDER-${id}`,
    lastTotalCents: total,
    ...(opts.agentClient !== undefined ? { agentClient: opts.agentClient } : { agentClient: "Counter MCP" }),
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Stores a completed cart and books its order through `sink` (a plain
 * DbOrderSink by default), as a Store Sync checkout would.
 */
export async function bookOrder(
  db: Db,
  opts: { cart?: CartRecord; payerId?: string; sink?: OrderSink } = {},
): Promise<{ order: Order; cart: CartRecord }> {
  const cart = opts.cart ?? completedCart(opts.payerId !== undefined ? { payerId: opts.payerId } : {});
  await new DbCartRepo(db).insert(cart);
  const sink = opts.sink ?? new DbOrderSink(db, { publicBaseUrl: "https://counter.test" });
  const { merchantOrderNumber } = await sink.onCompleted(cart, { authorizationId: `AUTH-${cart.id}`, payerId: opts.payerId ?? "PAYER9" });
  const order = await orderRow(db, merchantOrderNumber);
  return { order: order!, cart };
}

export async function orderRow(db: Db, id: string): Promise<Order | undefined> {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row;
}

export async function stockOf(db: Db, shopId: string, variantId: string): Promise<number> {
  const [row] = await db
    .select({ stock: variants.stock })
    .from(variants)
    .where(and(eq(variants.shopId, shopId), eq(variants.variantId, variantId)));
  return row!.stock;
}

export async function eventsOf(db: Db, type: string, ref?: string) {
  const rows = await db.select().from(events).where(eq(events.type, type)).orderBy(asc(events.id));
  return ref === undefined ? rows : rows.filter((r) => r.ref === ref);
}
