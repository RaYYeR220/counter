import { SIMULATOR_WEBHOOK_ID, handlePayPalWebhook } from "@counter/platform";
import { db, paypal } from "@/lib/server/runtime";
import { errorResponse, json } from "@/app/api/merchant/_lib/http";

/**
 * PayPal webhook endpoint. `PAYPAL_WEBHOOK_ID` is the id PayPal gave this
 * webhook; every delivery is verified with PayPal against it. Set it to
 * `WEBHOOK_ID` only to accept PayPal's webhook simulator, whose deliveries
 * cannot be verified and are recorded as unverified.
 */
export async function POST(req: Request): Promise<Response> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    return json(503, { error: "webhook_not_configured", message: "Set PAYPAL_WEBHOOK_ID to this webhook's id at PayPal" });
  }
  try {
    const rawBody = await req.text();
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const client = webhookId === SIMULATOR_WEBHOOK_ID ? undefined : paypal();
    const out = await handlePayPalWebhook(db(), client, { headers, rawBody, webhookId });
    if (out.ok) return json(200, out);
    return json(out.handled === "bad_signature" || out.handled === "unverifiable" ? 401 : 400, out);
  } catch (err) {
    // A 5xx makes PayPal redeliver; handling is idempotent per event id.
    return errorResponse(err, "paypal.webhook");
  }
}
