import type {
  AuthorizeResult,
  CartRecord,
  ComputedCartForPayment,
  PaymentPort,
  PayPalCart,
  StoreSyncDeps,
} from "@counter/store-sync";
import { DbCartRepo, DbCatalog, DbOrderSink, createTestDb, seedCatalog, type Db } from "../src/index";

export const SHOP = "juniper-clay";
export const NOW = new Date("2026-11-09T15:00:00.000Z");
export const BASE_URL = "https://counter.example";

export async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await seedCatalog(db, { publicBaseUrl: BASE_URL });
  return db;
}

/** Plays PayPal Orders v2: idempotent create per request id, buyer approval, authorize. */
export class FakePayments implements PaymentPort {
  readonly created: string[] = [];
  readonly authorized: string[] = [];
  readonly approved = new Set<string>();
  /** Runs before a patch is applied, e.g. to let another writer get in first. Cleared after it runs. */
  beforePatch: (() => Promise<void>) | null = null;
  private seq = 0;
  private byRequest = new Map<string, string>();

  async createOrder(_shopId: string, _cart: ComputedCartForPayment, requestId: string) {
    let orderId = this.byRequest.get(requestId);
    if (!orderId) {
      orderId = `5O19${String(++this.seq).padStart(4, "0")}TN364715T`;
      this.byRequest.set(requestId, orderId);
      this.created.push(orderId);
    }
    return { orderId, approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` };
  }

  async patchOrder() {
    const hook = this.beforePatch;
    this.beforePatch = null;
    await hook?.();
    return "ok" as const;
  }

  /** The buyer approves the order on PayPal. */
  approve(orderId: string): void {
    this.approved.add(orderId);
  }

  async authorizeOrder(_shopId: string, orderId: string): Promise<AuthorizeResult> {
    this.authorized.push(orderId);
    if (!this.approved.has(orderId)) return { status: "DECLINED", reason: "ORDER_NOT_APPROVED" };
    return { status: "COMPLETED", authorizationId: `AUTH-${orderId}`, payerId: "QYR5Z8XDVJNXQ" };
  }
}

export interface DbDeps extends StoreSyncDeps {
  carts: DbCartRepo;
  payments: FakePayments;
  orders: DbOrderSink;
  errors: unknown[];
}

export function makeDeps(db: Db): DbDeps {
  let n = 0;
  const errors: unknown[] = [];
  return {
    catalog: new DbCatalog(db),
    carts: new DbCartRepo(db),
    payments: new FakePayments(),
    orders: new DbOrderSink(db, { publicBaseUrl: BASE_URL }),
    now: () => NOW,
    newCartId: () => `CART-T${String(++n).padStart(9, "0")}`,
    onError: (err) => errors.push(err),
    errors,
  };
}

/** A create/replace body: items as [parent_id, variant_id, quantity], shipping to San Jose, CA. */
export function cartBody(items: Array<[string, string, number]>, over: Partial<PayPalCart> = {}): PayPalCart {
  return {
    items: items.map(([parent_id, variant_id, quantity]) => ({ parent_id, variant_id, quantity })),
    customer: { name: { given_name: "John", surname: "Doe" }, email_address: "jdoe-pp@paypal.com" },
    shipping_address: {
      address_line_1: "456 Fictional St",
      admin_area_2: "San Jose",
      admin_area_1: "CA",
      postal_code: "95131",
      country_code: "US",
    },
    payment_method: { type: "paypal" },
    ...over,
  };
}

const usd = (value: string) => ({ currency_code: "USD" as const, value });

export function cartRecord(over: Partial<CartRecord> = {}): CartRecord {
  return {
    id: "CART-AAAAAAAAAA",
    shopId: SHOP,
    status: "INCOMPLETE",
    cart: {
      id: "CART-AAAAAAAAAA",
      status: "INCOMPLETE",
      validation_status: "REQUIRES_ADDITIONAL_INFORMATION",
      items: [
        {
          variant_id: "JC-MUG-SPECKLE-SAGE-12",
          parent_id: "JC-MUG-SPECKLE",
          quantity: 2,
          name: "Speckled mug — sage, 12 oz",
          price: usd("34.00"),
          selected_attributes: [
            { name: "glaze", value: "sage" },
            { name: "size", value: "12 oz" },
          ],
        },
      ],
      totals: {
        subtotal: usd("68.00"),
        shipping: usd("0.00"),
        tax: usd("0.00"),
        total: usd("68.00"),
      },
    } satisfies PayPalCart,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}
