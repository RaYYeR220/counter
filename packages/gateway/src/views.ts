import { fmt, toCents, type Address, type Customer, type PayPalCart, type ValidationIssue } from "@counter/store-sync";

/** A cart as returned by Store Sync, plus the confirmation sent after checkout. */
export type StoreCart = PayPalCart & {
  payment_confirmation?: { merchant_order_number: string; order_review_page: string };
};

export interface CartLine {
  variant_id: string;
  parent_id?: string;
  name?: string;
  quantity: number;
  /** Unit price, two decimals. */
  unit_price?: string;
  line_total?: string;
}

export interface CartShippingOption {
  id: string;
  name: string;
  price: string;
  estimated_delivery?: string;
  selected: boolean;
}

export interface CartTotalsView {
  currency: string;
  subtotal?: string;
  discount?: string;
  shipping?: string;
  tax?: string;
  total: string;
}

export interface CartView {
  shop: string;
  cart_id: string;
  status: string;
  validation_status: string;
  /** True when the cart is valid and has a PayPal order: it can go to checkout. */
  ready_for_checkout: boolean;
  items: CartLine[];
  shipping_address?: Address;
  customer?: Customer;
  shipping_options: CartShippingOption[];
  totals: CartTotalsView;
  /** PayPal Orders v2 id for this cart (`payment_method.token`), once the cart is valid. */
  paypal_order_id: string | null;
  /** The shop's validation issues, exactly as the shop sent them. */
  validation_issues: ValidationIssue[];
  next_step: string;
}

function lineTotal(price: string | undefined, quantity: number): string | undefined {
  if (!price) return undefined;
  try {
    return fmt(toCents(price) * quantity);
  } catch {
    return undefined;
  }
}

function nextStep(v: Omit<CartView, "next_step">): string {
  if (v.status === "COMPLETED") return "The order is placed. Use order_status to look it up again.";
  if (v.ready_for_checkout) {
    return "Confirm the items, shipping address and total with the user, then call checkout.";
  }
  if (v.validation_status === "REQUIRES_ADDITIONAL_INFORMATION") {
    return "The shop needs more information: supply it with update_cart (see validation_issues).";
  }
  return (
    "The cart cannot be checked out yet. Explain each issue's user_message to the user and fix the cart with " +
    "update_cart using one of its resolution_options. Never swap in a different variant without the user's agreement."
  );
}

export function cartView(shop: string, cart: StoreCart): CartView {
  const token = cart.payment_method?.token ?? null;
  const t = cart.totals;
  const status = cart.status ?? "INCOMPLETE";
  const validation = cart.validation_status ?? "INVALID";
  const base: Omit<CartView, "next_step"> = {
    shop,
    cart_id: cart.id ?? "",
    status,
    validation_status: validation,
    ready_for_checkout: status === "CREATED" && validation === "VALID" && !!token,
    items: (cart.items ?? []).map((i) => {
      const unit = i.price?.value;
      const total = lineTotal(unit, i.quantity);
      return {
        variant_id: i.variant_id ?? i.item_id ?? "",
        ...(i.parent_id ? { parent_id: i.parent_id } : {}),
        ...(i.name ? { name: i.name } : {}),
        quantity: i.quantity,
        ...(unit ? { unit_price: unit } : {}),
        ...(total ? { line_total: total } : {}),
      };
    }),
    ...(cart.shipping_address ? { shipping_address: cart.shipping_address } : {}),
    ...(cart.customer ? { customer: cart.customer } : {}),
    shipping_options: (cart.available_shipping_options ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      price: o.price.value,
      ...(o.estimated_delivery ? { estimated_delivery: o.estimated_delivery } : {}),
      selected: !!o.is_selected,
    })),
    totals: {
      currency: t?.total?.currency_code ?? "USD",
      ...(t?.subtotal ? { subtotal: t.subtotal.value } : {}),
      ...(t?.discount ? { discount: t.discount.value } : {}),
      ...(t?.shipping ? { shipping: t.shipping.value } : {}),
      ...(t?.tax ? { tax: t.tax.value } : {}),
      total: t?.total?.value ?? "0.00",
    },
    paypal_order_id: token,
    validation_issues: cart.validation_issues ?? [],
  };
  return { ...base, next_step: nextStep(base) };
}

// ---------------------------------------------------------------------------
// Text

export function usd(v: string | undefined): string {
  return `$${v ?? "0.00"}`;
}

/** "Subtotal $60.00 · Shipping $5.99 · Tax $4.78 · Total $70.77 · PayPal order 5O19..." */
export function totalsLine(v: CartView): string {
  const t = v.totals;
  return [
    `Subtotal ${usd(t.subtotal)}`,
    ...(t.discount ? [`Discount -${usd(t.discount)}`] : []),
    `Shipping ${usd(t.shipping)}`,
    `Tax ${usd(t.tax)}`,
    `Total ${usd(t.total)}`,
    v.paypal_order_id ? `PayPal order ${v.paypal_order_id}` : "No PayPal order yet",
  ].join(" · ");
}

export function addressLine(a: Address): string {
  return [a.address_line_1, a.address_line_2, a.admin_area_2, [a.admin_area_1, a.postal_code].filter(Boolean).join(" "), a.country_code]
    .filter(Boolean)
    .join(", ");
}

export function issueLines(issues: readonly ValidationIssue[]): string[] {
  return issues.map((i) => {
    const what = i.user_message || i.message;
    const options = (i.resolution_options ?? []).map((o) => o.label).filter(Boolean);
    const target = i.variant_id ? ` (${i.variant_id})` : "";
    return `- [${i.code}]${target} ${what}${options.length ? ` Options: ${options.join("; ")}` : ""}`;
  });
}

export function cartText(v: CartView): string {
  const lines = [`Cart ${v.cart_id} at ${v.shop}: ${v.status} (${v.validation_status})`];
  for (const i of v.items) {
    const price = i.unit_price ? ` at ${usd(i.unit_price)} = ${usd(i.line_total)}` : "";
    lines.push(`- ${i.quantity} x ${i.name ?? i.variant_id} [${i.variant_id}]${price}`);
  }
  if (v.shipping_address) lines.push(`Ship to: ${addressLine(v.shipping_address)}`);
  const selected = v.shipping_options.find((o) => o.selected);
  if (selected) {
    const others = v.shipping_options
      .filter((o) => !o.selected)
      .map((o) => `${o.id} ${usd(o.price)}${o.estimated_delivery ? ` (est. ${o.estimated_delivery})` : ""}`);
    lines.push(
      `Shipping: ${selected.name} ${usd(selected.price)}${selected.estimated_delivery ? `, est. ${selected.estimated_delivery}` : ""}` +
        (others.length ? ` · also available: ${others.join(", ")}` : ""),
    );
  }
  lines.push(totalsLine(v));
  if (v.validation_issues.length) lines.push("Issues:", ...issueLines(v.validation_issues));
  lines.push(`Next: ${v.next_step}`);
  return lines.join("\n");
}
