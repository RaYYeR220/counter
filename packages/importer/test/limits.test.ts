import { describe, expect, it } from "vitest";
import { RateGate, TtlCache } from "../src/channel3/limits";

function clock(start = 0) {
  let t = start;
  const slept: number[] = [];
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

describe("TtlCache", () => {
  it("serves a value until it expires", async () => {
    const c = clock();
    const cache = new TtlCache<string>(1000, c.now);
    let calls = 0;
    const load = async () => `v${++calls}`;
    expect(await cache.get("k", load)).toBe("v1");
    c.advance(999);
    expect(await cache.get("k", load)).toBe("v1");
    c.advance(2);
    expect(await cache.get("k", load)).toBe("v2");
  });

  it("shares one load between concurrent callers", async () => {
    const cache = new TtlCache<string>(1000, () => 0);
    let calls = 0;
    const load = async () => {
      calls++;
      return "v";
    };
    await Promise.all([cache.get("k", load), cache.get("k", load), cache.get("k", load)]);
    expect(calls).toBe(1);
  });

  it("does not keep failures or values the caller says not to keep", async () => {
    const cache = new TtlCache<string | null>(1000, () => 0, (v) => v !== null);
    await expect(cache.get("k", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await cache.get("k", async () => null)).toBeNull();
    expect(await cache.get("k", async () => "ok")).toBe("ok");
  });
});

describe("RateGate", () => {
  it("spaces call starts by the minimum interval", async () => {
    const c = clock(10_000);
    const gate = new RateGate(200, c.now, c.sleep);
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map(() => gate.run(async () => starts.push(c.now()))));
    expect(starts).toEqual([10_000, 10_200, 10_400]);
  });

  it("does not wait when calls are already far apart", async () => {
    const c = clock(10_000);
    const gate = new RateGate(200, c.now, c.sleep);
    await gate.run(async () => undefined);
    c.advance(500);
    await gate.run(async () => undefined);
    expect(c.slept).toEqual([]);
  });

  it("keeps going after a call fails", async () => {
    const c = clock();
    const gate = new RateGate(100, c.now, c.sleep);
    await expect(gate.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await gate.run(async () => "ok")).toBe("ok");
  });
});
