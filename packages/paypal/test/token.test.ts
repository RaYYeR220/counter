import { describe, it, expect } from "vitest";
import { TokenCache, PayPalApiError } from "../src/index";
import { ENV, fakePayPal } from "./fake";

describe("TokenCache", () => {
  it("requests a client-credentials token with basic auth", async () => {
    const pp = fakePayPal();
    const cache = new TokenCache(ENV, pp.fetch);
    const token = await cache.get();

    expect(token.accessToken).toBe("A21-token");
    const [call] = pp.tokenCalls();
    expect(call!.method).toBe("POST");
    expect(call!.url.href).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(call!.headers.get("authorization")).toBe(
      "Basic " + Buffer.from("PLATFORM-CLIENT:PLATFORM-SECRET").toString("base64"),
    );
    expect(call!.contentType).toBe("application/x-www-form-urlencoded");
    expect(call!.text).toBe("grant_type=client_credentials");
  });

  it("reuses the token until expires_in minus 60 seconds", async () => {
    let now = 1_000_000;
    const pp = fakePayPal({
      "POST /v1/oauth2/token": [
        { json: { access_token: "first", token_type: "Bearer", expires_in: 3600 } },
        { json: { access_token: "second", token_type: "Bearer", expires_in: 3600 } },
      ],
    });
    const cache = new TokenCache(ENV, pp.fetch, () => now);

    expect((await cache.get()).accessToken).toBe("first");
    now += (3600 - 61) * 1000;
    expect((await cache.get()).accessToken).toBe("first");
    expect(pp.tokenCalls()).toHaveLength(1);

    now += 2 * 1000;
    expect((await cache.get()).accessToken).toBe("second");
    expect(pp.tokenCalls()).toHaveLength(2);
  });

  it("reports when the cached token stops being usable", async () => {
    const pp = fakePayPal({
      "POST /v1/oauth2/token": { json: { access_token: "t", token_type: "Bearer", expires_in: 100 } },
    });
    const cache = new TokenCache(ENV, pp.fetch, () => 5_000);
    const token = await cache.get();
    expect(token.expiresAt).toBe(5_000 + 40 * 1000);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const pp = fakePayPal();
    const cache = new TokenCache(ENV, pp.fetch);
    const [a, b, c] = await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(a.accessToken).toBe(b.accessToken);
    expect(b.accessToken).toBe(c.accessToken);
    expect(pp.tokenCalls()).toHaveLength(1);
  });

  it("throws a PayPalApiError on bad credentials and retries on the next call", async () => {
    const pp = fakePayPal({
      "POST /v1/oauth2/token": [
        { status: 401, json: { error: "invalid_client", error_description: "Client Authentication failed" } },
        { json: { access_token: "ok", token_type: "Bearer", expires_in: 3600 } },
      ],
    });
    const cache = new TokenCache(ENV, pp.fetch);
    const err = await cache.get().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).status).toBe(401);
    expect((err as PayPalApiError).paypalName).toBe("invalid_client");
    expect((await cache.get()).accessToken).toBe("ok");
  });
});
