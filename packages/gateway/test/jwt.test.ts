import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { SCOPES, verifyPayPalJwt, type VerifyPayPalJwtOptions } from "@counter/store-sync";
import {
  GATEWAY_KID,
  gatewayPublicKeyPem,
  generateGatewayKeyPair,
  publicJwks,
  signStoreSyncJwt,
  type GatewayKeyPair,
} from "../src/index";

const MERCHANT = "L6PQ645YDJ3LA";

let keys: GatewayKeyPair;
let other: GatewayKeyPair;

beforeAll(async () => {
  [keys, other] = await Promise.all([generateGatewayKeyPair(), generateGatewayKeyPair()]);
});

const savedEnv = process.env.GATEWAY_PRIVATE_KEY_PEM;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.GATEWAY_PRIVATE_KEY_PEM;
  else process.env.GATEWAY_PRIVATE_KEY_PEM = savedEnv;
});

function verifyOpts(
  requiredScopes: readonly string[],
  over: Partial<VerifyPayPalJwtOptions> = {},
): VerifyPayPalJwtOptions {
  return {
    mode: "sandbox",
    sandboxKeys: [keys.publicKeyPem],
    jwksUrl: "https://www.paypal.ai/.well-known/jwks.json",
    merchantId: MERCHANT,
    requiredScopes,
    ...over,
  };
}

async function sign(scopes: ("cart" | "checkout")[], over: { merchantId?: string; privateKeyPem?: string } = {}) {
  return signStoreSyncJwt({
    merchantId: over.merchantId ?? MERCHANT,
    clientIdentifier: "Counter",
    scopes,
    privateKeyPem: over.privateKeyPem ?? keys.privateKeyPem,
  });
}

describe("generateGatewayKeyPair", () => {
  it("returns a PKCS8 private key and an SPKI public key as PEM", () => {
    expect(keys.privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n?$/);
    expect(keys.publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----\n?$/);
    expect(keys.privateKeyPem).not.toBe(other.privateKeyPem);
  });
});

describe("signStoreSyncJwt", () => {
  it("uses the header PayPal sends", async () => {
    expect(decodeProtectedHeader(await sign(["cart"]))).toEqual({ alg: "RS256", typ: "JWT", kid: "5874bc103b80920f" });
    expect(GATEWAY_KID).toBe("5874bc103b80920f");
  });

  it("carries the claims PayPal sends, valid for ten minutes", async () => {
    const now = new Date("2026-11-09T15:00:00Z");
    const token = await signStoreSyncJwt({
      merchantId: MERCHANT,
      clientIdentifier: "Counter",
      scopes: ["cart", "checkout"],
      privateKeyPem: keys.privateKeyPem,
      now,
    });
    const iat = now.getTime() / 1000;
    expect(decodeJwt(token)).toEqual({
      iss: "paypal.com",
      sub: "counter-gateway",
      aud: "counter",
      iat,
      exp: iat + 600,
      scope: ["cart", "checkout"],
      external_id: [`PayPal:${MERCHANT}`, "Client_Identifier:Counter"],
    });
  });

  it("verifies for cart operations with the gateway public key", async () => {
    const res = await verifyPayPalJwt(`Bearer ${await sign(["cart"])}`, verifyOpts(SCOPES.cart));
    expect(res).toMatchObject({ ok: true, clientIdentifier: "Counter" });
  });

  it("verifies for checkout when both scopes are granted", async () => {
    const res = await verifyPayPalJwt(`Bearer ${await sign(["cart", "checkout"])}`, verifyOpts(SCOPES.checkout));
    expect(res.ok).toBe(true);
  });

  it("is rejected for checkout without the checkout scope", async () => {
    const res = await verifyPayPalJwt(`Bearer ${await sign(["cart"])}`, verifyOpts(SCOPES.checkout));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(401);
    expect(res.body.details?.[0]?.issue).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("is rejected by a shop with a different merchant id", async () => {
    const res = await verifyPayPalJwt(
      `Bearer ${await sign(["cart"], { merchantId: "OTHERMERCHANT1" })}`,
      verifyOpts(SCOPES.cart),
    );
    expect(res.ok).toBe(false);
  });

  it("is rejected when signed with a key the shop does not trust", async () => {
    const res = await verifyPayPalJwt(
      `Bearer ${await sign(["cart"], { privateKeyPem: other.privateKeyPem })}`,
      verifyOpts(SCOPES.cart),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.body.details?.[0]?.issue).toBe("SIGNATURE_VERIFICATION_FAILED");
  });

  it("reads the key from GATEWAY_PRIVATE_KEY_PEM when none is passed", async () => {
    process.env.GATEWAY_PRIVATE_KEY_PEM = keys.privateKeyPem;
    const token = await signStoreSyncJwt({ merchantId: MERCHANT, clientIdentifier: "Counter", scopes: ["cart"] });
    expect((await verifyPayPalJwt(`Bearer ${token}`, verifyOpts(SCOPES.cart))).ok).toBe(true);
  });

  it("accepts a key whose line breaks were stored as \\n escapes", async () => {
    process.env.GATEWAY_PRIVATE_KEY_PEM = keys.privateKeyPem.trim().replace(/\n/g, "\\n");
    const token = await signStoreSyncJwt({ merchantId: MERCHANT, clientIdentifier: "Counter", scopes: ["cart"] });
    expect((await verifyPayPalJwt(`Bearer ${token}`, verifyOpts(SCOPES.cart))).ok).toBe(true);
  });

  it("fails with a clear message when no key is configured", async () => {
    delete process.env.GATEWAY_PRIVATE_KEY_PEM;
    await expect(
      signStoreSyncJwt({ merchantId: MERCHANT, clientIdentifier: "Counter", scopes: ["cart"] }),
    ).rejects.toThrow(/GATEWAY_PRIVATE_KEY_PEM/);
  });
});

describe("publicJwks", () => {
  it("publishes only the public half of the gateway key under the PayPal kid", async () => {
    const jwks = await publicJwks(keys.privateKeyPem);
    expect(jwks.keys).toHaveLength(1);
    const [jwk] = jwks.keys;
    expect(jwk).toMatchObject({ kty: "RSA", kid: GATEWAY_KID, alg: "RS256", use: "sig", e: "AQAB" });
    expect(Object.keys(jwk!).sort()).toEqual(["alg", "e", "kid", "kty", "n", "use"]);
  });

  it("publishes a key that verifies gateway tokens", async () => {
    const [jwk] = (await publicJwks(keys.privateKeyPem)).keys;
    const res = await verifyPayPalJwt(
      `Bearer ${await sign(["cart"])}`,
      verifyOpts(SCOPES.cart, { sandboxKeys: [jwk!] }),
    );
    expect(res.ok).toBe(true);
  });

  it("derives the SPKI public key from the private key", async () => {
    expect(await gatewayPublicKeyPem(keys.privateKeyPem)).toBe(keys.publicKeyPem);
  });
});
