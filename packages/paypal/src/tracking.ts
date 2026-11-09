import { ShipmentCarrier, type OrderTrackerRequest } from "@paypal/paypal-server-sdk";
import type { OrderItem } from "./env";
import { dropUndefined } from "./orders";
import type { Transport } from "./transport";

export interface TrackingParams {
  captureId: string;
  trackingNumber: string;
  /** A PayPal carrier code such as `USPS`, `UPS`, `FEDEX`; anything else is sent as OTHER. */
  carrier: string;
  items?: OrderItem[];
  /** Let PayPal email the buyer the tracking details. */
  notifyPayer?: boolean;
}

const KNOWN_CARRIERS = new Set<string>(Object.values(ShipmentCarrier));

/** Adds shipment tracking to a captured order (shown to the buyer, used in disputes). */
export async function addTracking(
  t: Transport,
  orderId: string,
  merchantId: string | undefined,
  p: TrackingParams,
): Promise<void> {
  const known = KNOWN_CARRIERS.has(p.carrier) && p.carrier !== ShipmentCarrier.Other;
  const body: OrderTrackerRequest = dropUndefined({
    captureId: p.captureId,
    trackingNumber: p.trackingNumber,
    carrier: known ? (p.carrier as ShipmentCarrier) : ShipmentCarrier.Other,
    carrierNameOther: known ? undefined : p.carrier,
    notifyPayer: p.notifyPayer,
    items: p.items?.map((i) => dropUndefined({ name: i.name, quantity: String(i.quantity), sku: i.sku, url: i.url, imageUrl: i.imageUrl })),
  });
  await t.sdkCall(`POST /v2/checkout/orders/${orderId}/track`, () =>
    t.orders.createOrderTracking({ id: orderId, body, paypalAuthAssertion: t.assertion(merchantId) }),
  );
}
