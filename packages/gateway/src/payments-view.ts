/** Where the buyer stands with a PayPal order. */
export type ApprovalStatus = "CREATED" | "APPROVED" | "COMPLETED" | "UNKNOWN";

export interface OrderApproval {
  /** CREATED: awaiting the buyer; APPROVED: ready to complete; COMPLETED: already authorized or captured. */
  status: ApprovalStatus;
  /** The buyer's PayPal payer id, once they have approved. */
  payerId?: string;
  /** Where the buyer approves the payment. */
  approveUrl: string;
}

/**
 * Read-only view of PayPal orders, used to tell whether the buyer has approved
 * a cart's payment before the gateway asks the shop to complete checkout.
 */
export interface OrderLookup {
  approvalState(shop: string, paypalOrderId: string): Promise<OrderApproval>;
}
