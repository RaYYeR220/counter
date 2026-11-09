import { describe, expect, it } from "vitest";
import { readCookie, SESSION_TTL_MS, signSession, verifySession } from "@/lib/console/session-token";

const KEY = "test-merchant-key";
const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

describe("merchant session tokens", () => {
  it("verifies a token for the shop it was signed for until it expires", () => {
    const token = signSession("juniper-clay", KEY, NOW);
    expect(verifySession(token, "juniper-clay", KEY, NOW)).toBe(true);
    expect(verifySession(token, "juniper-clay", KEY, NOW + SESSION_TTL_MS - 1)).toBe(true);
  });

  it("refuses an expired token", () => {
    const token = signSession("juniper-clay", KEY, NOW);
    expect(verifySession(token, "juniper-clay", KEY, NOW + SESSION_TTL_MS)).toBe(false);
    expect(verifySession(token, "juniper-clay", KEY, NOW + SESSION_TTL_MS + 60_000)).toBe(false);
  });

  it("refuses a token for another shop", () => {
    const token = signSession("juniper-clay", KEY, NOW);
    expect(verifySession(token, "northpaw-roasters", KEY, NOW)).toBe(false);
  });

  it("refuses a token moved to another shop or given a later expiry", () => {
    const [, expiry, mac] = signSession("juniper-clay", KEY, NOW).split(".");
    expect(verifySession(`northpaw-roasters.${expiry}.${mac}`, "northpaw-roasters", KEY, NOW)).toBe(false);
    expect(verifySession(`juniper-clay.${Number(expiry) + 86_400_000}.${mac}`, "juniper-clay", KEY, NOW)).toBe(false);
  });

  it("refuses a tampered signature, a different key and malformed values", () => {
    const token = signSession("juniper-clay", KEY, NOW);
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(verifySession(flipped, "juniper-clay", KEY, NOW)).toBe(false);
    expect(verifySession(token, "juniper-clay", "another-key", NOW)).toBe(false);
    expect(verifySession(token, "juniper-clay", undefined, NOW)).toBe(false);
    for (const bad of ["", "juniper-clay", "juniper-clay.123", "juniper-clay.abc.def", `${token}.extra`, "juniper-clay.1.zz"]) {
      expect(verifySession(bad, "juniper-clay", KEY, NOW)).toBe(false);
    }
  });

  it("will not sign for a value that is not a shop slug", () => {
    expect(() => signSession("Juniper.Clay", KEY, NOW)).toThrow();
    expect(() => signSession("juniper-clay", "", NOW)).toThrow();
  });

  it("reads one cookie out of a Cookie header", () => {
    expect(readCookie("a=1; counter_merchant=x.y.z; b=2", "counter_merchant")).toBe("x.y.z");
    expect(readCookie("a=1", "counter_merchant")).toBeUndefined();
    expect(readCookie(null, "counter_merchant")).toBeUndefined();
  });
});
