import "server-only";
import { DbCartRepo, type OrderStatus, type Tracking } from "@counter/db";
import { toCents, type PayPalCart } from "@counter/store-sync";
import { db } from "@/lib/server/runtime";

export interface OrderLineView {
  variantId: string;
  parentId: string;
  name: string;
  quantity: number;
  unitCents: number;
  lineCents: number;
}

export interface OrderView {
  id: string;
  status: OrderStatus;
  placedAt: string;
  totalCents: number;
  subtotalCents: number | null;
  discountCents: number;
  shippingCents: number | null;
  taxCents: number | null;
  shippingOption: { name: string; estimatedDelivery: string | null } | null;
  shipTo: { city: string; state: string } | null;
  lines: OrderLineView[];
  tracking: Tracking | null;
}

function cents(value: string | undefined | null): number | null {
  if (!value) return null;
  try {
    return toCents(value);
  } catch {
    return null;
  }
}

/** One of a shop's orders with its lines and totals, or null. */
export async function getOrderView(slug: string, orderId: string): Promise<OrderView | null> {
  const order = await db().query.orders.findFirst({
    where: (o, { and, eq }) => and(eq(o.shopId, slug), eq(o.id, orderId)),
  });
  if (!order) return null;

  const record = await new DbCartRepo(db()).get(slug, order.cartId);
  const cart: PayPalCart = record?.cart ?? {};
  const selected = cart.available_shipping_options?.find((o) => o.is_selected);
  const addr = cart.shipping_address;

  return {
    id: order.id,
    status: order.status,
    placedAt: order.createdAt.toISOString(),
    totalCents: order.totalCents,
    subtotalCents: cents(cart.totals?.subtotal?.value),
    discountCents: cents(cart.totals?.discount?.value) ?? 0,
    shippingCents: cents(cart.totals?.shipping?.value),
    taxCents: cents(cart.totals?.tax?.value),
    shippingOption: selected ? { name: selected.name, estimatedDelivery: selected.estimated_delivery ?? null } : null,
    shipTo: addr?.admin_area_2 && addr.admin_area_1 ? { city: addr.admin_area_2, state: addr.admin_area_1 } : null,
    lines: (cart.items ?? []).map((item) => {
      const unit = cents(item.price?.value) ?? 0;
      return {
        variantId: item.variant_id ?? "",
        parentId: item.parent_id ?? "",
        name: item.name ?? item.variant_id ?? "Item",
        quantity: item.quantity,
        unitCents: unit,
        lineCents: unit * item.quantity,
      };
    }),
    tracking: order.tracking ?? null,
  };
}
