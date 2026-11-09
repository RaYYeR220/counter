import "server-only";
import { createDb, DbCartRepo, DbCatalog, DbOrderSink, getShop, publicBaseUrl, type Db, type Shop } from "@counter/db";
import { gatewayPublicKeyPem, StoreSyncClient, type OrderLookup } from "@counter/gateway";
import { PayPal, SANDBOX_BASE } from "@counter/paypal";
import { veniceClient } from "@counter/negotiate";
import {
  DbShopDirectory,
  NegotiationService,
  offerDiscounts,
  PayPalOrderLookup,
  PayPalPayments,
  SANDBOX_APPROVE_BASE,
  StockKeepingOrderSink,
  type ShopAccounts,
} from "@counter/platform";
import { PaymentsUnavailable, randomCartId, type PaymentPort, type StoreSyncDeps } from "@counter/store-sync";

// ---------------------------------------------------------------------------
// Benchmark switches, for local benchmark runs only (bench/purchase). Both are
// refused on Vercel so a deployment can never run on a pinned clock or without
// real payments.

function localOnly(name: string): void {
  if (process.env.VERCEL) throw new Error(`${name} is for local benchmark runs and must not be set on Vercel`);
}

let pinnedClock: Date | null | undefined;

/** The store's clock. `COUNTER_CLOCK` (an ISO time) pins it, so delivery dates are the same on every run. */
export function storeNow(): Date {
  if (pinnedClock === undefined) {
    const raw = process.env.COUNTER_CLOCK;
    if (!raw) {
      pinnedClock = null;
    } else {
      localOnly("COUNTER_CLOCK");
      const at = new Date(raw);
      if (Number.isNaN(at.getTime())) throw new Error(`COUNTER_CLOCK is not a valid ISO time: ${raw}`);
      pinnedClock = at;
    }
  }
  return pinnedClock ? new Date(pinnedClock) : new Date();
}

/** `PAYMENTS_MODE=stub`: PayPal is replaced by a stub that approves and authorizes every order. */
export function paymentsStubbed(): boolean {
  if (process.env.PAYMENTS_MODE !== "stub") return false;
  localOnly("PAYMENTS_MODE=stub");
  return true;
}

export const STUB_PAYER_ID = "BENCHPAYER01";

/** One deterministic order per cart, always authorized. Payment is not what the benchmark measures. */
const stubPayments: PaymentPort = {
  async createOrder(_shop, cart) {
    const orderId = `STUB-${cart.cartId}`;
    return { orderId, approveUrl: `${SANDBOX_APPROVE_BASE}${orderId}` };
  },
  async patchOrder() {
    return "ok";
  },
  async authorizeOrder(_shop, orderId) {
    return { status: "COMPLETED", authorizationId: `AUTH-${orderId}`, payerId: STUB_PAYER_ID };
  },
};

/** Every stub order reads as approved by the same payer. */
const stubOrderLookup: OrderLookup = {
  async approvalState(_shop, orderId) {
    return { status: "APPROVED", payerId: STUB_PAYER_ID, approveUrl: `${SANDBOX_APPROVE_BASE}${orderId}` };
  },
};

let dbHandle: Db | undefined;
export function db(): Db {
  return (dbHandle ??= createDb());
}

let paypalClient: PayPal | undefined;
export function paypal(): PayPal {
  if (!paypalClient) {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
    paypalClient = new PayPal({
      clientId,
      clientSecret,
      base: SANDBOX_BASE,
      ...(process.env.PAYPAL_BN_CODE ? { bnCode: process.env.PAYPAL_BN_CODE } : {}),
      ...(process.env.PAYPAL_PARTNER_MERCHANT_ID ? { partnerMerchantId: process.env.PAYPAL_PARTNER_MERCHANT_ID } : {}),
    });
  }
  return paypalClient;
}

export function baseUrl(): string {
  return publicBaseUrl();
}

/**
 * The merchant id carried in Store Sync tokens for a shop. Onboarded shops use
 * their PayPal merchant id; demo shops paid to the platform account use a
 * stable placeholder so tokens still name exactly one merchant.
 */
export function merchantRef(shop: Pick<Shop, "slug" | "paypalMerchantId">): string {
  return shop.paypalMerchantId ?? `COUNTER-${shop.slug.toUpperCase()}`;
}

const shopCache = new Map<string, { at: number; shop: Shop | null }>();
export async function loadShop(slug: string): Promise<Shop | null> {
  const hit = shopCache.get(slug);
  if (hit && Date.now() - hit.at < 10_000) return hit.shop;
  const shop = await getShop(db(), slug);
  shopCache.set(slug, { at: Date.now(), shop });
  return shop;
}

export const shopAccounts: ShopAccounts = {
  async merchantIdFor(slug) {
    const shop = await loadShop(slug);
    // A shop whose PayPal consent was revoked is no longer paid out to its own account.
    if (!shop || shop.onboardingStatus === "revoked") return undefined;
    return shop.paypalMerchantId ?? undefined;
  },
  async brandFor(slug) {
    return (await loadShop(slug))?.name;
  },
};

/** Public keys accepted on sandbox-mode Store Sync calls: the gateway's, plus an optional test key. */
let gatewayPem: Promise<string> | undefined;
export async function sandboxKeys(): Promise<string[]> {
  const keys = [await (gatewayPem ??= gatewayPublicKeyPem())];
  const extra = process.env.STORE_SYNC_TEST_PUBLIC_KEY_PEM?.replace(/\n/g, "\n");
  if (extra) keys.push(extra);
  return keys;
}

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/**
 * Used while PayPal credentials are missing: carts can still be priced and
 * validated, and anything that needs a PayPal order fails with a clear named
 * error instead of a crash.
 */
const notConnected = () =>
  new PaymentsUnavailable("PAYMENTS_NOT_CONNECTED", "This shop has not connected PayPal payments yet, so no order can be placed.");
const paymentsNotConfigured: PaymentPort = {
  async createOrder() {
    throw notConnected();
  },
  async patchOrder() {
    throw notConnected();
  },
  async authorizeOrder() {
    throw notConnected();
  },
};

export function storeSyncDeps(): StoreSyncDeps {
  const d = db();
  return {
    catalog: new DbCatalog(d),
    carts: new DbCartRepo(d),
    payments: paymentsStubbed()
      ? stubPayments
      : paypalConfigured()
        ? new PayPalPayments(paypal(), shopAccounts, {
            returnUrl: (slug) => `${baseUrl()}/paypal/return?shop=${encodeURIComponent(slug)}`,
            cancelUrl: (slug) => `${baseUrl()}/paypal/return?shop=${encodeURIComponent(slug)}&cancelled=1`,
          })
        : paymentsNotConfigured,
    orders: new StockKeepingOrderSink(d, new DbOrderSink(d, { publicBaseUrl: baseUrl() })),
    now: storeNow,
    newCartId: randomCartId,
    discounts: offerDiscounts(d),
    onError: (err, where) => console.error("store-sync", where, err),
  };
}

let directory: DbShopDirectory | undefined;
export function shopDirectory(): DbShopDirectory {
  return (directory ??= new DbShopDirectory(db(), { now: storeNow }));
}

export function storeSyncClient(clientIdentifier: string): StoreSyncClient {
  return new StoreSyncClient({
    baseUrl: (slug) => `${baseUrl()}/s/${encodeURIComponent(slug)}/paypal/v1`,
    merchantIdFor: async (slug) => {
      const shop = await loadShop(slug);
      if (!shop) throw new Error(`unknown shop ${slug}`);
      return merchantRef(shop);
    },
    clientIdentifier,
  });
}

export function orderLookup(): OrderLookup {
  if (paymentsStubbed()) return stubOrderLookup;
  return new PayPalOrderLookup(paypal(), shopAccounts);
}

/** Model behind each shop's seller agent. */
export const SELLER_MODEL = process.env.COUNTER_SELLER_MODEL ?? "z-ai-glm-5-3-flash";

let negotiationService: NegotiationService | undefined;
export function negotiation(): NegotiationService {
  if (!negotiationService) {
    const apiKey = process.env.VENICE_API_KEY;
    if (!apiKey) throw new Error("VENICE_API_KEY must be set for the seller agent");
    negotiationService = new NegotiationService(db(), veniceClient({ apiKey, timeoutMs: 45_000, retries: 2 }), SELLER_MODEL);
  }
  return negotiationService;
}
