function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * `PayPal-Auth-Assertion` value for calling PayPal on behalf of an onboarded
 * merchant: an unsigned JWT (`alg: none`, empty signature) whose payload names
 * the platform app (`iss`) and the merchant's PayPal payer id (`payer_id`).
 */
export function authAssertion(clientId: string, merchantId: string): string {
  return `${b64url({ alg: "none" })}.${b64url({ iss: clientId, payer_id: merchantId })}.`;
}
