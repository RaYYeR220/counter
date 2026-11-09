import { beforeAll, describe, expect, it } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  exportSPKI,
  generateKeyPair,
  type CryptoKey,
  type JWTPayload,
} from "jose";
import { AuthenticationIssueCodeSchema, createCartResponse401Schema } from "@paypal/commerce-cart-zod";
import { verifyPayPalJwt, SCOPES, type VerifyPayPalJwtOptions } from "../src/index";

const PROD_KID = "5874bc103b80920f";
const MERCHANT = "L6PQ645YDJ3LA";

let sandbox: { privateKey: CryptoKey; publicKey: CryptoKey };
let other: { privateKey: CryptoKey; publicKey: CryptoKey };
let prod: { privateKey: CryptoKey; publicKey: CryptoKey };

beforeAll(async () => {
  [sandbox, other, prod] = await Promise.all([
    generateKeyPair("RS256", { extractable: true }),
    generateKeyPair("RS256"),
    generateKeyPair("RS256", { extractable: true }),
  ]);
});

function claims(over: JWTPayload = {}): JWTPayload {
  return {
    iss: "paypal.com",
    sub: "merchant-id",
    aud: "platform.com",
    scope: ["cart", "checkout"],
    external_id: [`PayPal:${MERCHANT}`, "Honey:7340912388130054912", "Client_Identifier:Perplexity"],
    ...over,
  };
}

async function rs256(payload: JWTPayload, key = sandbox.privateKey, opts: { exp?: string | number; kid?: string } = {}) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: opts.kid ?? PROD_KID })
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(key);
}

function b64(obj: unknown) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function opts(over: Partial<VerifyPayPalJwtOptions> = {}): VerifyPayPalJwtOptions {
  return {
    mode: "sandbox",
    sandboxKeys: [sandbox.publicKey],
    jwksUrl: "https://www.paypal.ai/.well-known/jwks.json",
    merchantId: MERCHANT,
    requiredScopes: SCOPES.cart,
    ...over,
  };
}

async function expectFailure(header: string | null, issue: string, o = opts()) {
  const res = await verifyPayPalJwt(header, o);
  expect(res.ok).toBe(false);
  if (res.ok) return;
  expect(res.status).toBe(401);
  expect(res.body.name).toBe("AUTHENTICATION_FAILED");
  expect(res.body.message.length).toBeGreaterThan(0);
  expect(res.body.details?.[0]?.issue).toBe(issue);
  expect(AuthenticationIssueCodeSchema.safeParse(res.body.details?.[0]?.issue).success).toBe(true);
  expect(createCartResponse401Schema.safeParse(res.body).success).toBe(true);
}

describe("verifyPayPalJwt: sandbox mode", () => {
  it("accepts an RS256 token signed with a sandbox key even though it carries the production kid", async () => {
    const res = await verifyPayPalJwt(`Bearer ${await rs256(claims())}`, opts());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.claims.iss).toBe("paypal.com");
    expect(res.clientIdentifier).toBe("Perplexity");
  });

  it("accepts a sandbox key given as an SPKI PEM string", async () => {
    const pem = await exportSPKI(sandbox.publicKey);
    const res = await verifyPayPalJwt(`Bearer ${await rs256(claims())}`, opts({ sandboxKeys: [pem] }));
    expect(res.ok).toBe(true);
  });

  it("tries every configured sandbox key", async () => {
    const res = await verifyPayPalJwt(
      `Bearer ${await rs256(claims())}`,
      opts({ sandboxKeys: [other.publicKey, sandbox.publicKey] }),
    );
    expect(res.ok).toBe(true);
  });

  it("accepts a space-delimited scope string", async () => {
    const res = await verifyPayPalJwt(`Bearer ${await rs256(claims({ scope: "cart checkout" }))}`, opts());
    expect(res.ok).toBe(true);
  });

  it("leaves clientIdentifier undefined when the token has none", async () => {
    const res = await verifyPayPalJwt(
      `Bearer ${await rs256(claims({ external_id: [`PayPal:${MERCHANT}`] }))}`,
      opts(),
    );
    expect(res.ok && res.clientIdentifier).toBeUndefined();
  });

  it("rejects a missing or empty Authorization header as TOKEN_MISSING", async () => {
    await expectFailure(null, "TOKEN_MISSING");
    await expectFailure("", "TOKEN_MISSING");
    await expectFailure("Bearer ", "TOKEN_MISSING");
  });

  it("rejects a non-Bearer scheme", async () => {
    await expectFailure("Basic dXNlcjpwYXNz", "TOKEN_INVALID");
  });

  it("rejects an unresolved Postman vault placeholder", async () => {
    await expectFailure("Bearer {{vault:json-web-token}}", "TOKEN_INVALID");
  });

  it("rejects garbage that only looks like a JWT", async () => {
    await expectFailure("Bearer a.b.c", "TOKEN_INVALID");
    await expectFailure("Bearer x.y", "TOKEN_INVALID");
  });

  it("rejects HS256 even when the issuer is paypal.com", async () => {
    const secret = new TextEncoder().encode("not-a-paypal-secret-but-long-enough-0123456789");
    const hs = await new SignJWT({ aud: "lasertechnologies.com", sub: "123", iss: "paypal.com" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime("1h")
      .sign(secret);
    await expectFailure(`Bearer ${hs}`, "TOKEN_INVALID");
  });

  it("rejects an unsigned alg=none token", async () => {
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims({ exp: Math.floor(Date.now() / 1000) + 600 }))}.`;
    await expectFailure(`Bearer ${none}`, "TOKEN_INVALID");
  });

  it("rejects a token signed by an unknown key", async () => {
    await expectFailure(`Bearer ${await rs256(claims(), other.privateKey)}`, "SIGNATURE_VERIFICATION_FAILED");
  });

  it("reports an expired token as TOKEN_EXPIRED", async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await expectFailure(`Bearer ${await rs256(claims(), sandbox.privateKey, { exp: past })}`, "TOKEN_EXPIRED");
  });

  it("tolerates a minute of clock skew", async () => {
    const justNow = Math.floor(Date.now() / 1000) - 30;
    const res = await verifyPayPalJwt(`Bearer ${await rs256(claims(), sandbox.privateKey, { exp: justNow })}`, opts());
    expect(res.ok).toBe(true);
  });

  it("requires an expiry", async () => {
    const noExp = await new SignJWT(claims())
      .setProtectedHeader({ alg: "RS256", kid: PROD_KID })
      .sign(sandbox.privateKey);
    await expectFailure(`Bearer ${noExp}`, "TOKEN_INVALID");
  });

  it("rejects a token from any other issuer", async () => {
    await expectFailure(`Bearer ${await rs256(claims({ iss: "evil.example" }))}`, "TOKEN_INVALID");
  });

  it("requires the checkout scope for checkout", async () => {
    const cartOnly = await rs256(claims({ scope: ["cart"] }));
    expect((await verifyPayPalJwt(`Bearer ${cartOnly}`, opts())).ok).toBe(true);
    await expectFailure(`Bearer ${cartOnly}`, "INSUFFICIENT_PERMISSIONS", opts({ requiredScopes: SCOPES.checkout }));
  });

  it("requires the cart scope for cart operations", async () => {
    await expectFailure(`Bearer ${await rs256(claims({ scope: [] }))}`, "INSUFFICIENT_PERMISSIONS");
    await expectFailure(`Bearer ${await rs256(claims({ scope: undefined }))}`, "INSUFFICIENT_PERMISSIONS");
  });

  it("requires the token to name this merchant", async () => {
    await expectFailure(
      `Bearer ${await rs256(claims({ external_id: ["PayPal:SOMEONE_ELSE", "Client_Identifier:Meta"] }))}`,
      "INSUFFICIENT_PERMISSIONS",
    );
    await expectFailure(`Bearer ${await rs256(claims({ external_id: undefined }))}`, "INSUFFICIENT_PERMISSIONS");
  });

  it("fails closed when no sandbox key is configured", async () => {
    await expectFailure(`Bearer ${await rs256(claims())}`, "SIGNATURE_VERIFICATION_FAILED", opts({ sandboxKeys: [] }));
  });
});

describe("verifyPayPalJwt: production mode", () => {
  async function prodJwks() {
    const jwk = await exportJWK(prod.publicKey);
    return { keys: [{ ...jwk, kid: PROD_KID, alg: "RS256", use: "sig" }] };
  }

  it("verifies against the published key set, selected by kid", async () => {
    const jwks = createLocalJWKSet(await prodJwks());
    const res = await verifyPayPalJwt(`Bearer ${await rs256(claims(), prod.privateKey)}`, opts({ mode: "paypal", jwks }));
    expect(res.ok).toBe(true);
  });

  it("does not trust sandbox keys", async () => {
    const jwks = createLocalJWKSet(await prodJwks());
    await expectFailure(
      `Bearer ${await rs256(claims(), sandbox.privateKey)}`,
      "SIGNATURE_VERIFICATION_FAILED",
      opts({ mode: "paypal", jwks }),
    );
  });

  it("fetches the key set once and caches it", async () => {
    const body = JSON.stringify(await prodJwks());
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const o = opts({ mode: "paypal", fetch: fetchImpl, jwksUrl: "https://keys.example/cache-test.json" });
    const token = `Bearer ${await rs256(claims(), prod.privateKey)}`;
    expect((await verifyPayPalJwt(token, o)).ok).toBe(true);
    expect((await verifyPayPalJwt(token, o)).ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("answers 401 rather than throwing when the key set cannot be loaded", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expectFailure(
      `Bearer ${await rs256(claims(), prod.privateKey)}`,
      "SIGNATURE_VERIFICATION_FAILED",
      opts({ mode: "paypal", fetch: fetchImpl, jwksUrl: "https://keys.example/down.json" }),
    );
  });
});
