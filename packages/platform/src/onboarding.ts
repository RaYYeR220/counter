const TRACKING_PREFIX = "counter-";

/** Our id for a shop in PayPal's onboarding: `counter-<slug>`. */
export function trackingIdFor(shopSlug: string): string {
  return `${TRACKING_PREFIX}${shopSlug}`;
}

/** The shop slug in a tracking id made by `trackingIdFor`, or null. */
export function slugFromTrackingId(trackingId: string | null | undefined): string | null {
  if (!trackingId?.startsWith(TRACKING_PREFIX) || trackingId.length === TRACKING_PREFIX.length) return null;
  return trackingId.slice(TRACKING_PREFIX.length);
}
