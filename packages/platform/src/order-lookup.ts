import { PayPalApiError, type PayPal } from "@counter/paypal";
import type { ApprovalStatus, OrderApproval, OrderLookup } from "@counter/gateway";
import type { ShopAccounts } from "./payments";

export const SANDBOX_APPROVE_BASE = "https://www.sandbox.paypal.com/checkoutnow?token=";

/** Maps an Orders v2 status to where the buyer stands. */
export function approvalStatusOf(status: string | undefined): ApprovalStatus {
  switch (status) {
    case "CREATED":
    case "SAVED":
    case "PAYER_ACTION_REQUIRED":
      return "CREATED";
    case "APPROVED":
      return "APPROVED";
    case "COMPLETED":
      return "COMPLETED";
    default:
      return "UNKNOWN";
  }
}

/** Reads PayPal orders on behalf of the shop that owns them. */
export class PayPalOrderLookup implements OrderLookup {
  constructor(
    private readonly paypal: PayPal,
    private readonly shops: Pick<ShopAccounts, "merchantIdFor">,
    private readonly approveBase: string = SANDBOX_APPROVE_BASE,
  ) {}

  async approvalState(shop: string, paypalOrderId: string): Promise<OrderApproval> {
    const fallbackUrl = `${this.approveBase}${encodeURIComponent(paypalOrderId)}`;
    try {
      const merchantId = await this.shops.merchantIdFor(shop);
      const order = await this.paypal.getOrder(paypalOrderId, merchantId);
      const status = approvalStatusOf(order.status);
      return {
        status,
        ...(order.payerId && status !== "CREATED" ? { payerId: order.payerId } : {}),
        approveUrl: order.approveUrl ?? fallbackUrl,
      };
    } catch (err) {
      if (err instanceof PayPalApiError && err.status === 404) return { status: "UNKNOWN", approveUrl: fallbackUrl };
      throw err;
    }
  }
}
