import { exportJWK, exportPKCS8, exportSPKI, generateKeyPair, importJWK, importPKCS8, type CryptoKey } from "jose";

/**
 * Key id PayPal puts in the header of Cart API tokens. Self-signed sandbox
 * tokens reuse it, so merchants verify them against the configured test key.
 */
export const GATEWAY_KID = "5874bc103b80920f";

/** Environment variable holding the gateway's PKCS8 private key (PEM). */
export const PRIVATE_KEY_ENV = "GATEWAY_PRIVATE_KEY_PEM";

export interface GatewayKeyPair {
  /** PKCS8 PEM; keep secret. */
  privateKeyPem: string;
  /** SPKI PEM; give it to merchants as their sandbox verification key. */
  publicKeyPem: string;
}

export interface PublicJwk {
  kty: "RSA";
  n: string;
  e: string;
  kid: string;
  alg: "RS256";
  use: "sig";
}

/** A fresh 2048-bit RSA signing key pair. */
export async function generateGatewayKeyPair(): Promise<GatewayKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true, modulusLength: 2048 });
  return { privateKeyPem: await exportPKCS8(privateKey), publicKeyPem: await exportSPKI(publicKey) };
}

/** Undoes `\n` escaping, which is how multi-line PEMs often survive env files and dashboards. */
function normalizePem(pem: string): string {
  return pem.trim().replace(/\\n/g, "\n");
}

/** The configured private key PEM: the argument if given, else `GATEWAY_PRIVATE_KEY_PEM`. */
export function gatewayPrivateKeyPem(privateKeyPem?: string): string {
  const pem = privateKeyPem ?? globalThis.process?.env?.[PRIVATE_KEY_ENV];
  if (!pem?.trim()) {
    throw new Error(`No gateway signing key: set ${PRIVATE_KEY_ENV} to a PKCS8 PEM private key`);
  }
  return normalizePem(pem);
}

const privateKeys = new Map<string, Promise<CryptoKey>>();

/** Imports (once per PEM) the private signing key. */
export function signingKey(privateKeyPem?: string): Promise<CryptoKey> {
  const pem = gatewayPrivateKeyPem(privateKeyPem);
  let key = privateKeys.get(pem);
  if (!key) {
    key = importPKCS8(pem, "RS256", { extractable: true });
    privateKeys.set(pem, key);
    key.catch(() => privateKeys.delete(pem));
  }
  return key;
}

/** The public half of the signing key as a JWK, tagged with the gateway kid. */
export async function publicJwk(privateKeyPem?: string): Promise<PublicJwk> {
  const jwk = await exportJWK(await signingKey(privateKeyPem));
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) throw new Error("The gateway signing key must be an RSA key");
  return { kty: "RSA", n: jwk.n, e: jwk.e, kid: GATEWAY_KID, alg: "RS256", use: "sig" };
}

/** Body for `/.well-known/jwks.json`. */
export async function publicJwks(privateKeyPem?: string): Promise<{ keys: PublicJwk[] }> {
  return { keys: [await publicJwk(privateKeyPem)] };
}

/** The public key as SPKI PEM, the form merchants configure as their sandbox key. */
export async function gatewayPublicKeyPem(privateKeyPem?: string): Promise<string> {
  const pub = await importJWK(await publicJwk(privateKeyPem), "RS256", { extractable: true });
  if (pub instanceof Uint8Array) throw new Error("Unexpected symmetric key");
  return exportSPKI(pub);
}
