import { readFileSync } from "node:fs";
import { decodeJwt } from "jose";
import {
  MemoryCartRepo,
  MemoryCatalog,
  SCOPES,
  checkoutCart,
  createCart,
  getCart,
  replaceCart,
  toCents,
  verifyPayPalJwt,
  type AuthorizeResult,
  type CartRecord,
  type CatalogVariant,
  type ComputedCartForPayment,
  type OrderSink,
  type PaymentPort,
  type StoreSyncDeps,
} from "@counter/store-sync";

/** Monday, 2026-11-09 15:00 UTC. */
export const NOW = new Date("2026-11-09T15:00:00Z");
export const SHOP_BASE = "https://counter.test";
export const PAYER_ID = "QYR5Z8XDVJNXQ";

export interface SeedVariant {
  variant_id: string;
  attributes: Record<string, string>;
  price: string;
  stock: number;
  active: boolean;
  purchasable: boolean;
  lead_time_days: number;
  flags: string[];
}
export interface SeedProduct {
  parent_id: string;
  name: string;
  variants: SeedVariant[];
}
export interface SeedShop {
  slug: string;
  products: SeedProduct[];
}

/** The demo catalog the database is seeded from. */
export function loadSeed<T = { shops: SeedShop[] }>(): T {
  return JSON.parse(readFileSync(new URL("../../db/src/seed/catalog.json", import.meta.url), "utf8")) as T;
}

export const MERCHANTS: Record<string, string> = {
  "juniper-clay": "JCLAYMERCHANT01",
  "northpaw-roasters": "NPAWMERCHANT001",
  "loop-and-lantern": "LOOPMERCHANT001",
};

export const AUSTIN = {
  address_line_1: "1100 Congress Ave",
  admin_area_2: "Austin",
  admin_area_1: "TX",
  postal_code: "78701",
  country_code: "US",
};

export const BUYER = {
  name: { given_name: "Dana", surname: "Reyes" },
  email_address: "dana@example.com",
};

/** Store Sync catalog variants for every shop in the seed. */
export function seedCatalog(seed = loadSeed()): MemoryCatalog {
  const byShop: Record<string, CatalogVariant[]> = {};
  for (const shop of seed.shops) {
    byShop[shop.slug] = shop.products.flatMap((p) =>
      p.variants.map((v) => ({
        variantId: v.variant_id,
        parentId: p.parent_id,
        name: `${p.name} (${Object.values(v.attributes).join(", ")})`,
        url: `${SHOP_BASE}/s/${shop.slug}/p/${p.parent_id}`,
        priceCents: toCents(v.price),
        stock: v.stock,
        attributes: v.attributes,
        active: v.active && v.purchasable,
      })),
    );
  }
  return new MemoryCatalog(byShop);
}

/**
 * Stands in for PayPal: Orders v2 on the merchant side, and the buyer's
 * approval step. Authorization fails until the buyer has approved.
 */
export class FakePayPal implements PaymentPort {
  readonly created: Array<{ shopId: string; orderId: string; cart: ComputedCartForPayment }> = [];
  readonly patched: Array<{ shopId: string; orderId: string; cart: ComputedCartForPayment }> = [];
  readonly authorized: string[] = [];
  readonly orders = new Map<string, { status: "CREATED" | "APPROVED" | "COMPLETED"; totalCents: number; payerId?: string }>();
  private seq = 0;
  private byRequest = new Map<string, string>();

  approveUrl(orderId: string): string {
    return `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`;
  }

  async createOrder(shopId: string, cart: ComputedCartForPayment, requestId: string) {
    let orderId = this.byRequest.get(requestId);
    if (!orderId) {
      orderId = `5O19${String(++this.seq).padStart(4, "0")}TN364715T`;
      this.byRequest.set(requestId, orderId);
      this.orders.set(orderId, { status: "CREATED", totalCents: cart.totalCents });
    }
    this.created.push({ shopId, orderId, cart });
    return { orderId, approveUrl: this.approveUrl(orderId) };
  }

  async patchOrder(shopId: string, orderId: string, cart: ComputedCartForPayment) {
    this.patched.push({ shopId, orderId, cart });
    const o = this.orders.get(orderId);
    if (!o) return "expired" as const;
    o.totalCents = cart.totalCents;
    return "ok" as const;
  }

  /** The buyer approves the order on PayPal. */
  approve(orderId: string, payerId = PAYER_ID): void {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`No PayPal order ${orderId}`);
    if (o.status === "CREATED") Object.assign(o, { status: "APPROVED", payerId });
  }

  async authorizeOrder(_shopId: string, orderId: string): Promise<AuthorizeResult> {
    const o = this.orders.get(orderId);
    if (!o || o.status === "CREATED") return { status: "DECLINED", reason: "ORDER_NOT_APPROVED" };
    if (o.status === "APPROVED") {
      o.status = "COMPLETED";
      this.authorized.push(orderId);
    }
    return { status: "COMPLETED", authorizationId: `AUTH-${orderId}`, payerId: o.payerId ?? PAYER_ID };
  }
}

export class FakeOrderBook implements OrderSink {
  readonly booked: CartRecord[] = [];
  private seq = 1000;

  async onCompleted(r: CartRecord) {
    this.booked.push(r);
    const n = `ORD-${++this.seq}`;
    return { merchantOrderNumber: n, orderReviewPage: `${SHOP_BASE}/orders/${n}` };
  }
}

export interface Shop {
  deps: StoreSyncDeps & { carts: MemoryCartRepo };
  paypal: FakePayPal;
  orderBook: FakeOrderBook;
}

export function makeShop(): Shop {
  let n = 0;
  const paypal = new FakePayPal();
  const orderBook = new FakeOrderBook();
  return {
    paypal,
    orderBook,
    deps: {
      catalog: seedCatalog(),
      carts: new MemoryCartRepo(),
      payments: paypal,
      orders: orderBook,
      now: () => NOW,
      newCartId: () => `CART-G${String(++n).padStart(9, "0")}`,
    },
  };
}

export interface SeenRequest {
  method: string;
  path: string;
  scope: unknown;
  externalId: unknown;
  iat: number | undefined;
  contentType: string | null;
  body: unknown;
}

/**
 * A fetch that serves the Store Sync routes in-process: it authenticates each
 * request the way a merchant does (sandbox mode, the gateway public key, the
 * shop's merchant id, the scopes the operation needs) and hands it to the
 * store-sync handlers.
 */
export function storeSyncFetch(shop: Shop, publicKeyPem: string) {
  const seen: SeenRequest[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const m = /^\/s\/([^/]+)\/paypal\/v1\/merchant-cart(?:\/([^/]+)(\/checkout)?)?$/.exec(url.pathname);
    const raw = req.method === "GET" ? undefined : await req.text();
    const authz = req.headers.get("authorization") ?? "";
    let claims: Record<string, unknown> = {};
    try {
      claims = decodeJwt(authz.replace(/^Bearer\s+/i, ""));
    } catch {
      // recorded as-is; verification below rejects it
    }
    seen.push({
      method: req.method,
      path: url.pathname,
      scope: claims.scope,
      externalId: claims.external_id,
      iat: typeof claims.iat === "number" ? claims.iat : undefined,
      contentType: req.headers.get("content-type"),
      body: raw === undefined ? undefined : JSON.parse(raw),
    });
    if (!m) return json(404, { name: "NOT_FOUND", message: "No such route" });
    const [, shopId, cartId, checkout] = m as unknown as [string, string, string | undefined, string | undefined];

    const auth = await verifyPayPalJwt(authz, {
      mode: "sandbox",
      sandboxKeys: [publicKeyPem],
      jwksUrl: "",
      merchantId: MERCHANTS[shopId] ?? "unknown",
      requiredScopes: checkout ? SCOPES.checkout : SCOPES.cart,
      currentDate: NOW,
    });
    if (!auth.ok) return json(auth.status, auth.body);

    let res;
    if (!cartId && req.method === "POST") {
      res = await createCart(shopId, raw, shop.deps, auth.clientIdentifier ? { clientIdentifier: auth.clientIdentifier } : {});
    } else if (cartId && checkout && req.method === "POST") {
      res = await checkoutCart(shopId, cartId, raw, shop.deps);
    } else if (cartId && !checkout && req.method === "GET") {
      res = await getCart(shopId, cartId, shop.deps);
    } else if (cartId && !checkout && req.method === "PUT") {
      res = await replaceCart(shopId, cartId, raw, shop.deps);
    } else {
      return json(405, { name: "METHOD_NOT_ALLOWED", message: "Method not allowed" });
    }
    return json(res.status, res.body);
  };
  return { fetch: fetchImpl as typeof fetch, seen };
}
