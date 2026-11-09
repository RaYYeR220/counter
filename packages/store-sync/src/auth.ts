import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  errors,
  importSPKI,
  jwtVerify,
  type CryptoKey,
  type JWK,
  type JWTPayload,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
  type KeyObject,
} from "jose";
import { errorBody, type ErrorBody } from "./errors";
import type { AuthenticationIssueCode } from "./types";

/** PayPal's published signing keys for production Cart API calls. */
export const PAYPAL_JWKS_URL = "https://www.paypal.ai/.well-known/jwks.json";
export const PAYPAL_ISSUER = "paypal.com";

/** Scopes each operation needs. */
export const SCOPES = {
  cart: ["cart"],
  checkout: ["cart", "checkout"],
} as const satisfies Record<string, readonly string[]>;

/** A public verification key. Strings are SPKI PEM. */
export type KeyLike = CryptoKey | KeyObject | JWK;

export interface VerifyPayPalJwtOptions {
  /**
   * `paypal`: keys come from PayPal's JWKS, selected by `kid`.
   * `sandbox`: tokens are self-signed for testing; they are checked against
   * `sandboxKeys` regardless of `kid` (test tokens reuse the production kid).
   */
  mode: "sandbox" | "paypal";
  sandboxKeys: ReadonlyArray<KeyLike | string>;
  jwksUrl: string;
  /** Our PayPal merchant id; the token must list `PayPal:<merchantId>` in `external_id`. */
  merchantId: string;
  requiredScopes: readonly string[];
  /** Key resolver for `paypal` mode. Defaults to a cached remote key set at `jwksUrl`. */
  jwks?: JWTVerifyGetKey;
  /** Fetch used to load the remote key set. */
  fetch?: typeof fetch;
  /** Allowed clock skew in seconds. Default 60. */
  clockToleranceSec?: number;
  currentDate?: Date;
}

export type VerifyPayPalJwtResult =
  | { ok: true; claims: JWTPayload; clientIdentifier?: string }
  | { ok: false; status: 401; body: ErrorBody };

const MESSAGES: Record<AuthenticationIssueCode, string> = {
  TOKEN_MISSING: "Authorization header with a Bearer token is required",
  TOKEN_INVALID: "The provided JWT could not be validated",
  TOKEN_EXPIRED: "The provided JWT has expired",
  SIGNATURE_VERIFICATION_FAILED: "The JWT signature could not be verified",
  INSUFFICIENT_PERMISSIONS: "The JWT does not grant access to this resource",
};

function deny(issue: AuthenticationIssueCode, description?: string): VerifyPayPalJwtResult {
  return {
    ok: false,
    status: 401,
    body: errorBody("AUTHENTICATION_FAILED", MESSAGES[issue], [
      { field: "authorization", issue, description: description ?? MESSAGES[issue] },
    ]),
  };
}

const importedPems = new Map<string, Promise<CryptoKey>>();
function resolveKey(k: KeyLike | string): Promise<KeyLike> {
  if (typeof k !== "string") return Promise.resolve(k);
  let p = importedPems.get(k);
  if (!p) {
    p = importSPKI(k, "RS256");
    importedPems.set(k, p);
    p.catch(() => importedPems.delete(k));
  }
  return p;
}

const remoteSets = new Map<string, JWTVerifyGetKey>();
const remoteSetsByFetch = new WeakMap<typeof fetch, Map<string, JWTVerifyGetKey>>();
function remoteJwks(url: string, fetchImpl?: typeof fetch): JWTVerifyGetKey {
  let cache = remoteSets;
  if (fetchImpl) {
    cache = remoteSetsByFetch.get(fetchImpl) ?? new Map();
    remoteSetsByFetch.set(fetchImpl, cache);
  }
  let set = cache.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 60 * 60 * 1000,
      timeoutDuration: 3000,
      ...(fetchImpl ? { [customFetch]: (u: string, init: RequestInit) => fetchImpl(u, init) } : {}),
    });
    cache.set(url, set);
  }
  return set;
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return v.split(/\s+/).filter(Boolean);
  return [];
}

/** Maps a verification error to an auth issue, or null if another key might still match. */
function classify(err: unknown): AuthenticationIssueCode | null {
  if (err instanceof errors.JWTExpired) return "TOKEN_EXPIRED";
  if (err instanceof errors.JWTClaimValidationFailed) return "TOKEN_INVALID";
  if (err instanceof errors.JWTInvalid || err instanceof errors.JOSEAlgNotAllowed) return "TOKEN_INVALID";
  if (err instanceof errors.JWSInvalid) return "TOKEN_INVALID";
  return null;
}

/**
 * Verifies the `Authorization` header PayPal sends with every Cart API call.
 * Only RS256 is accepted; the issuer must be paypal.com; the token must carry
 * the required scopes and name our merchant id. Any failure yields a 401 body
 * in the API's error shape, never an exception.
 */
export async function verifyPayPalJwt(
  header: string | null | undefined,
  opts: VerifyPayPalJwtOptions,
): Promise<VerifyPayPalJwtResult> {
  const raw = header?.trim() ?? "";
  if (!raw) return deny("TOKEN_MISSING");
  const m = /^Bearer(?:\s+(.*))?$/i.exec(raw);
  if (!m) return deny("TOKEN_INVALID", "Authorization must use the Bearer scheme");
  const token = m[1]?.trim() ?? "";
  if (!token) return deny("TOKEN_MISSING");
  if (!/^[\w-]+\.[\w-]+\.[\w-]*$/.test(token)) return deny("TOKEN_INVALID", "Malformed JWT");

  let alg: unknown;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return deny("TOKEN_INVALID", "Malformed JWT header");
  }
  if (alg !== "RS256") return deny("TOKEN_INVALID", "Only RS256-signed tokens are accepted");

  const verifyOpts: JWTVerifyOptions = {
    algorithms: ["RS256"],
    issuer: PAYPAL_ISSUER,
    requiredClaims: ["exp"],
    clockTolerance: opts.clockToleranceSec ?? 60,
    ...(opts.currentDate ? { currentDate: opts.currentDate } : {}),
  };

  let claims: JWTPayload | undefined;
  if (opts.mode === "sandbox") {
    for (const k of opts.sandboxKeys) {
      try {
        claims = (await jwtVerify(token, await resolveKey(k), verifyOpts)).payload;
        break;
      } catch (err) {
        const issue = classify(err);
        if (issue) return deny(issue);
      }
    }
    if (!claims) return deny("SIGNATURE_VERIFICATION_FAILED");
  } else {
    try {
      const getKey = opts.jwks ?? remoteJwks(opts.jwksUrl || PAYPAL_JWKS_URL, opts.fetch);
      claims = (await jwtVerify(token, getKey, verifyOpts)).payload;
    } catch (err) {
      const issue = classify(err);
      if (issue) return deny(issue);
      if (err instanceof errors.JWKSNoMatchingKey || err instanceof errors.JWSSignatureVerificationFailed) {
        return deny("SIGNATURE_VERIFICATION_FAILED");
      }
      return deny("SIGNATURE_VERIFICATION_FAILED", "Signing keys could not be loaded");
    }
  }

  const scopes = asList(claims.scope);
  const missing = opts.requiredScopes.filter((s) => !scopes.includes(s));
  if (missing.length) return deny("INSUFFICIENT_PERMISSIONS", `Missing scope: ${missing.join(", ")}`);

  const externalIds = asList(claims.external_id);
  if (!externalIds.includes(`PayPal:${opts.merchantId}`)) {
    return deny("INSUFFICIENT_PERMISSIONS", "The token was not issued for this merchant");
  }

  const client = externalIds.find((e) => e.startsWith("Client_Identifier:"))?.slice("Client_Identifier:".length);
  return { ok: true, claims, ...(client ? { clientIdentifier: client } : {}) };
}
