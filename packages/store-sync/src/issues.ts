import type { CatalogVariant } from "./catalog";
import { SHIPPING_COUNTRIES } from "./shipping";
import type { ValidationIssue } from "./types";

const REMOVE_ITEM = { action: "REMOVE_ITEM", label: "Remove this item from the cart" } as const;

export function itemNotFound(variantId: string, index: number): ValidationIssue {
  return {
    code: "DATA_ERROR",
    type: "INVALID_DATA",
    severity: "ERROR",
    message: "Product not found",
    user_message: "This product is not available from this store.",
    variant_id: variantId,
    field: `items[${index}].variant_id`,
    context: { specific_issue: "ITEM_NOT_FOUND", field_name: "variant_id", provided_value: variantId },
    resolution_options: [REMOVE_ITEM],
  };
}

export function itemDiscontinued(v: CatalogVariant, index: number): ValidationIssue {
  return {
    code: "INVENTORY_ISSUE",
    type: "BUSINESS_RULE",
    severity: "ERROR",
    message: "Product is no longer sold",
    user_message: `${v.name} is no longer available.`,
    variant_id: v.variantId,
    field: `items[${index}]`,
    context: { specific_issue: "ITEM_DISCONTINUED", variant_id: v.variantId },
    resolution_options: [REMOVE_ITEM],
  };
}

export function outOfStock(v: CatalogVariant, index: number, requested: number): ValidationIssue {
  return {
    code: "INVENTORY_ISSUE",
    type: "BUSINESS_RULE",
    severity: "ERROR",
    message: "Product is out of stock",
    user_message: `${v.name} is out of stock.`,
    variant_id: v.variantId,
    field: `items[${index}].quantity`,
    context: {
      specific_issue: "ITEM_OUT_OF_STOCK",
      variant_id: v.variantId,
      available_quantity: 0,
      requested_quantity: requested,
    },
    resolution_options: [REMOVE_ITEM],
  };
}

export function insufficientInventory(
  v: CatalogVariant,
  index: number,
  available: number,
  requested: number,
): ValidationIssue {
  return {
    code: "INVENTORY_ISSUE",
    type: "BUSINESS_RULE",
    severity: "ERROR",
    message: "Requested quantity exceeds available stock",
    user_message: `Only ${available} of ${v.name} left in stock.`,
    variant_id: v.variantId,
    field: `items[${index}].quantity`,
    context: {
      specific_issue: "INSUFFICIENT_INVENTORY",
      variant_id: v.variantId,
      available_quantity: available,
      requested_quantity: requested,
    },
    resolution_options: [
      { action: "MODIFY_CART", label: `Reduce quantity to ${available}`, metadata: { priority: "HIGH" } },
      REMOVE_ITEM,
    ],
  };
}

export function missingShippingAddress(): ValidationIssue {
  return {
    code: "DATA_ERROR",
    type: "MISSING_FIELD",
    severity: "ERROR",
    message: "Shipping address is required",
    user_message: "Add a shipping address to see delivery options and the final total.",
    field: "shipping_address",
    context: { specific_issue: "MISSING_SHIPPING_ADDRESS" },
    resolution_options: [{ action: "PROVIDE_MISSING_FIELD", label: "Add a shipping address" }],
  };
}

export function internationalShipping(country: string): ValidationIssue {
  return {
    code: "SHIPPING_ERROR",
    type: "BUSINESS_RULE",
    severity: "ERROR",
    message: "This store does not ship to the destination country",
    user_message: "This store only ships within the United States.",
    field: "shipping_address.country_code",
    context: {
      specific_issue: "INTERNATIONAL_SHIPPING_RESTRICTED",
      destination_country: country,
      supported_countries: [...SHIPPING_COUNTRIES],
    },
    resolution_options: [{ action: "UPDATE_ADDRESS", label: "Use a US shipping address" }],
  };
}

export function discountCodeInvalid(code: string): ValidationIssue {
  return {
    code: "DISCOUNT_ERROR",
    type: "INVALID_DATA",
    severity: "ERROR",
    message: "Discount code is not valid",
    user_message: `The code ${code} can't be applied to this cart.`,
    field: "discounts.codes",
    context: { specific_issue: "DISCOUNT_CODE_INVALID" },
    resolution_options: [{ action: "MODIFY_CART", label: "Remove the discount code" }],
  };
}

export function paymentDeclined(token: string, reason: string): ValidationIssue {
  return {
    code: "PAYMENT_ERROR",
    type: "BUSINESS_RULE",
    severity: "ERROR",
    message: "Payment was declined",
    user_message: "The payment could not be completed. Try a different payment method.",
    field: "payment_method.token",
    context: { specific_issue: "PAYMENT_DECLINED", decline_reason: reason, payment_token: token },
    resolution_options: [{ action: "USE_DIFFERENT_PAYMENT", label: "Use a different payment method" }],
  };
}

export function paymentExpired(token: string): ValidationIssue {
  return {
    code: "PAYMENT_ERROR",
    type: "BUSINESS_RULE",
    severity: "ERROR",
    message: "Payment approval has expired",
    user_message: "The payment approval expired. Approve the payment again to finish checkout.",
    field: "payment_method.token",
    context: { specific_issue: "PAYMENT_EXPIRED", payment_token: token },
    resolution_options: [{ action: "USE_DIFFERENT_PAYMENT", label: "Approve the payment again" }],
  };
}

export function cartAlreadyCompleted(): ValidationIssue {
  return {
    code: "BUSINESS_RULE_ERROR",
    type: "BUSINESS_RULE",
    severity: "ERROR",
    message: "Cart is already completed",
    user_message: "This order has already been placed. Start a new cart to buy more.",
    field: "status",
  };
}
