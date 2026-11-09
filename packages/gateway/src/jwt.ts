import { SignJWT } from "jose";
import { GATEWAY_KID, signingKey } from "./keys";

export type StoreSyncScope = "cart" | "checkout";

export const TOKEN_ISSUER = "paypal.com";
export const TOKEN_SUBJECT = "counter-gateway";
export const TOKEN_AUDIENCE = "counter";
export const TOKEN_TTL_SEC = 600;

export interface SignStoreSyncJwtParams {
  /** The shop's PayPal merchant id; sent as `PayPal:<merchantId>` in `external_id`. */
  merchantId: string;
  /** Which agent surface the buyer came from; sent as `Client_Identifier:<value>`. */
  clientIdentifier: string;
  scopes: StoreSyncScope[];
  /** PKCS8 PEM. Defaults to `GATEWAY_PRIVATE_KEY_PEM`. */
  privateKeyPem?: string;
  now?: Date;
}

/**
 * Signs the bearer token for a Store Sync Cart API call, with the header and
 * claims PayPal's platform uses: RS256, issuer paypal.com, the requested
 * scopes, and the shop's merchant id. Valid for ten minutes.
 */
export async function signStoreSyncJwt(p: SignStoreSyncJwtParams): Promise<string> {
  const key = await signingKey(p.privateKeyPem);
  const iat = Math.floor((p.now ?? new Date()).getTime() / 1000);
  return new SignJWT({
    scope: [...p.scopes],
    external_id: [`PayPal:${p.merchantId}`, `Client_Identifier:${p.clientIdentifier}`],
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: GATEWAY_KID })
    .setIssuer(TOKEN_ISSUER)
    .setSubject(TOKEN_SUBJECT)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + TOKEN_TTL_SEC)
    .sign(key);
}
