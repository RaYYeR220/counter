import "server-only";
import { createDb, DbCartRepo, DbCatalog, DbOrderSink, getShop, publicBaseUrl, type Db, type Shop } from "@counter/db";
import { gatewayPublicKeyPem, StoreSyncClient } from "@counter/gateway";
import { PayPal, SANDBOX_BASE } from "@counter/paypal";
import { veniceClient } from "@counter/negotiate";
import { DbShopDirectory, NegotiationService, offerDiscounts, PayPalOrderLookup, PayPalPayments, type ShopAccounts } from "@counter/platform";
import { randomCartId, type StoreSyncDeps } from "@counter/store-sync";

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
    return (await loadShop(slug))?.paypalMerchantId ?? undefined;
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

export function storeSyncDeps(): StoreSyncDeps {
  const d = db();
  return {
    catalog: new DbCatalog(d),
    carts: new DbCartRepo(d),
    payments: new PayPalPayments(paypal(), shopAccounts, {
      returnUrl: (slug) => `${baseUrl()}/paypal/return?shop=${encodeURIComponent(slug)}`,
      cancelUrl: (slug) => `${baseUrl()}/paypal/return?shop=${encodeURIComponent(slug)}&cancelled=1`,
    }),
    orders: new DbOrderSink(d, { publicBaseUrl: baseUrl() }),
    now: () => new Date(),
    newCartId: randomCartId,
    discounts: offerDiscounts(d),
    onError: (err, where) => console.error("store-sync", where, err),
  };
}

let directory: DbShopDirectory | undefined;
export function shopDirectory(): DbShopDirectory {
  return (directory ??= new DbShopDirectory(db()));
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

export function orderLookup(): PayPalOrderLookup {
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
