import type { Transport } from "./transport";

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === want) return v;
  return undefined;
}

/**
 * Verifies a webhook delivery with PayPal. The event is spliced into the
 * request as received, since re-serialising it can change the signed bytes.
 */
export async function verifyWebhook(
  t: Transport,
  headers: Record<string, string | undefined>,
  rawBody: string,
  webhookId: string,
): Promise<boolean> {
  const fields = {
    auth_algo: header(headers, "paypal-auth-algo"),
    cert_url: header(headers, "paypal-cert-url"),
    transmission_id: header(headers, "paypal-transmission-id"),
    transmission_sig: header(headers, "paypal-transmission-sig"),
    transmission_time: header(headers, "paypal-transmission-time"),
    webhook_id: webhookId,
  };
  if (Object.values(fields).some((v) => !v)) return false;
  const event = rawBody.trim();
  try {
    JSON.parse(event);
  } catch {
    return false;
  }
  const body = `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${event}}`;
  const { data } = await t.request<{ verification_status?: string }>(
    "POST",
    "/v1/notifications/verify-webhook-signature",
    { body, headers: { "Content-Type": "application/json" } },
  );
  return data.verification_status === "SUCCESS";
}
