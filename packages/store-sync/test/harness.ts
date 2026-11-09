import {
  MemoryCartRepo,
  MemoryCatalog,
  type AuthorizeResult,
  type CartRecord,
  type ComputedCartForPayment,
  type OrderSink,
  type PaymentPort,
  type StoreSyncDeps,
} from "../src/index";
import { CATALOG, NOW } from "./fixtures";

/** Stands in for PayPal Orders v2: idempotent create by request id, scripted patch/authorize outcomes. */
export class FakePayments implements PaymentPort {
  readonly created: Array<{ shopId: string; cart: ComputedCartForPayment; requestId: string; orderId: string }> = [];
  readonly patched: Array<{ shopId: string; orderId: string; cart: ComputedCartForPayment }> = [];
  readonly authorized: Array<{ shopId: string; orderId: string; requestId: string }> = [];
  /** Orders that PayPal reports as gone (expired) when patched. */
  readonly expired = new Set<string>();
  authorizeOutcome: AuthorizeResult | Error = { status: "COMPLETED", authorizationId: "AUTH-1", payerId: "QYR5Z8XDVJNXQ" };
  failCreate: Error | null = null;
  failPatch: Error | null = null;
  /** When set, authorization fails until the buyer has approved the order. */
  requireApproval = false;
  readonly approved = new Set<string>();
  /** Amount each PayPal order currently carries, in cents. */
  readonly orderTotals = new Map<string, number>();
  private seq = 0;
  private byRequest = new Map<string, string>();
  private authByRequest = new Map<string, AuthorizeResult>();

  async createOrder(shopId: string, cart: ComputedCartForPayment, requestId: string) {
    await Promise.resolve();
    if (this.failCreate) throw this.failCreate;
    let orderId = this.byRequest.get(requestId);
    if (!orderId) {
      orderId = `5O19${String(++this.seq).padStart(4, "0")}TN364715T`;
      this.byRequest.set(requestId, orderId);
    }
    this.created.push({ shopId, cart, requestId, orderId });
    if (!this.orderTotals.has(orderId)) this.orderTotals.set(orderId, cart.totalCents);
    return { orderId, approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` };
  }

  async patchOrder(shopId: string, orderId: string, cart: ComputedCartForPayment) {
    await Promise.resolve();
    if (this.failPatch) throw this.failPatch;
    this.patched.push({ shopId, orderId, cart });
    if (this.expired.has(orderId)) return "expired" as const;
    this.orderTotals.set(orderId, cart.totalCents);
    return "ok" as const;
  }

  /** The buyer approves the order on PayPal. */
  approve(orderId: string): void {
    this.approved.add(orderId);
  }

  async authorizeOrder(shopId: string, orderId: string, requestId: string) {
    await Promise.resolve();
    this.authorized.push({ shopId, orderId, requestId });
    const prior = this.authByRequest.get(requestId);
    if (prior) return prior;
    if (this.requireApproval && !this.approved.has(orderId)) {
      return { status: "DECLINED" as const, reason: "ORDER_NOT_APPROVED" };
    }
    if (this.authorizeOutcome instanceof Error) throw this.authorizeOutcome;
    if (this.authorizeOutcome.status === "COMPLETED") this.authByRequest.set(requestId, this.authorizeOutcome);
    return this.authorizeOutcome;
  }
}

export class FakeOrders implements OrderSink {
  readonly completed: Array<{ record: CartRecord; auth: { authorizationId: string; payerId: string } }> = [];
  fail: Error | null = null;
  private seq = 10041;

  async onCompleted(record: CartRecord, auth: { authorizationId: string; payerId: string }) {
    if (this.fail) throw this.fail;
    this.completed.push({ record, auth });
    const n = `ORD-${++this.seq}`;
    return { merchantOrderNumber: n, orderReviewPage: `https://shop.example/orders/${n}` };
  }
}

export interface TestDeps extends StoreSyncDeps {
  catalog: MemoryCatalog;
  carts: MemoryCartRepo;
  payments: FakePayments;
  orders: FakeOrders;
  errors: unknown[];
}

export function makeDeps(over: Partial<TestDeps> = {}): TestDeps {
  let n = 0;
  const errors: unknown[] = [];
  return {
    catalog: new MemoryCatalog(CATALOG),
    carts: new MemoryCartRepo(),
    payments: new FakePayments(),
    orders: new FakeOrders(),
    now: () => NOW,
    newCartId: () => `CART-T${String(++n).padStart(9, "0")}`,
    onError: (err) => errors.push(err),
    errors,
    ...over,
  };
}
