import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_TTL_MS, signSession, verifySession } from "@/lib/console/session-token";

// The routes run against stubbed data: these tests are about who may read what.
const SHOP = { slug: "juniper-clay", name: "Juniper Clay", owner: "Rosa Marín" };

vi.mock("@/lib/console/server/data", () => ({
  requireShop: vi.fn(async (slug: string) => (slug === "juniper-clay" || slug === "northpaw-roasters" ? { ...SHOP, slug } : null)),
  loadCatalog: vi.fn(async () => [{ variantId: "JC-MUG", priceCents: 3400, costCents: 1100, floorCents: 2900 }]),
  loadNegotiations: vi.fn(async () => [{ id: "n1", floorCents: 2900, transcript: [] }]),
  loadOrders: vi.fn(async () => [{ id: "JC-10001", shipTo: "Portland, OR" }]),
  loadEvents: vi.fn(async () => []),
  loadSummary: vi.fn(async () => ({ shop: { slug: "juniper-clay", name: "Juniper Clay" }, counts: { orders: 3 }, merchant: false })),
}));

vi.mock("@/lib/console/server/actions", () => ({
  runAction: vi.fn(async () => ({ ok: true, message: "Shipped JC-10001." })),
  actionError: vi.fn(() => ({ status: 500, message: "failed" })),
}));

const { GET: catalog } = await import("@/app/api/console/[shop]/catalog/route");
const { GET: negotiations } = await import("@/app/api/console/[shop]/negotiations/route");
const { GET: orders } = await import("@/app/api/console/[shop]/orders/route");
const { GET: events } = await import("@/app/api/console/[shop]/events/route");
const { GET: summary } = await import("@/app/api/console/[shop]/summary/route");
const { POST: act } = await import("@/app/api/console/[shop]/actions/route");
const { POST: signIn, DELETE: signOut } = await import("@/app/api/console/session/route");

const KEY = "route-test-merchant-key";
const ORIGIN = "https://counter.example";
const ctx = (shop: string) => ({ params: Promise.resolve({ shop }) });

let ip = 0;
function request(path: string, opts: { cookie?: string; method?: string; body?: unknown; origin?: string } = {}): Request {
  // A fresh address per request, so the per-visitor rate limits never get in the way.
  ip += 1;
  const headers: Record<string, string> = { "x-forwarded-host": "counter.example", "x-forwarded-for": `10.0.${ip >> 8}.${ip & 255}` };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

const sessionFor = (shop: string, now = Date.now()) => `counter_merchant=${signSession(shop, KEY, now)}`;

let savedKey: string | undefined;
beforeAll(() => {
  savedKey = process.env.MERCHANT_DEMO_KEY;
  process.env.MERCHANT_DEMO_KEY = KEY;
});
afterAll(() => {
  if (savedKey === undefined) delete process.env.MERCHANT_DEMO_KEY;
  else process.env.MERCHANT_DEMO_KEY = savedKey;
});
beforeEach(() => {
  vi.clearAllMocks();
});

describe("console data routes", () => {
  const routes = [
    ["catalog", catalog],
    ["negotiations", negotiations],
    ["orders", orders],
    ["events", events],
  ] as const;

  for (const [name, handler] of routes) {
    it(`${name}: 401 without a merchant session, 200 with one`, async () => {
      const denied = await handler(request(`/api/console/juniper-clay/${name}`), ctx("juniper-clay"));
      expect(denied.status).toBe(401);
      const body = await denied.json();
      expect(body.error).toBe("merchant_session_required");
      expect(JSON.stringify(body)).not.toMatch(/floorCents|costCents/);

      const allowed = await handler(request(`/api/console/juniper-clay/${name}`, { cookie: sessionFor("juniper-clay") }), ctx("juniper-clay"));
      expect(allowed.status).toBe(200);
    });
  }

  it("refuses a session for another shop and an expired one", async () => {
    const other = await catalog(request("/api/console/juniper-clay/catalog", { cookie: sessionFor("northpaw-roasters") }), ctx("juniper-clay"));
    expect(other.status).toBe(401);
    const expired = await catalog(
      request("/api/console/juniper-clay/catalog", { cookie: sessionFor("juniper-clay", Date.now() - SESSION_TTL_MS - 1000) }),
      ctx("juniper-clay"),
    );
    expect(expired.status).toBe(401);
  });

  it("returns costs and floors only behind the session", async () => {
    const res = await catalog(request("/api/console/juniper-clay/catalog", { cookie: sessionFor("juniper-clay") }), ctx("juniper-clay"));
    const body = await res.json();
    expect(body.variants[0]).toMatchObject({ costCents: 1100, floorCents: 2900 });
  });

  it("keeps the summary public, without floors or costs, and says whether the caller is the merchant", async () => {
    const anon = await summary(request("/api/console/juniper-clay/summary"), ctx("juniper-clay"));
    expect(anon.status).toBe(200);
    const anonBody = await anon.json();
    expect(anonBody.merchant).toBe(false);
    expect(JSON.stringify(anonBody)).not.toMatch(/floorCents|costCents/);
    const merchant = await summary(request("/api/console/juniper-clay/summary", { cookie: sessionFor("juniper-clay") }), ctx("juniper-clay"));
    expect((await merchant.json()).merchant).toBe(true);
  });

  it("actions need the session as well as the Console's origin", async () => {
    const body = { kind: "ship", orderId: "JC-10001", carrier: "USPS", trackingNumber: "9400" };
    const anon = await act(request("/api/console/juniper-clay/actions", { method: "POST", body, origin: ORIGIN }), ctx("juniper-clay"));
    expect(anon.status).toBe(401);
    const merchant = await act(
      request("/api/console/juniper-clay/actions", { method: "POST", body, origin: ORIGIN, cookie: sessionFor("juniper-clay") }),
      ctx("juniper-clay"),
    );
    expect(merchant.status).toBe(200);
    const crossSite = await act(
      request("/api/console/juniper-clay/actions", { method: "POST", body, origin: "https://elsewhere.example", cookie: sessionFor("juniper-clay") }),
      ctx("juniper-clay"),
    );
    expect(crossSite.status).toBe(403);
  });
});

describe("console session route", () => {
  it("signs in with an httpOnly, Secure, SameSite=Strict cookie valid for 12 hours", async () => {
    const res = await signIn(request("/api/console/session", { method: "POST", body: { shop: "juniper-clay" }, origin: ORIGIN }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^counter_merchant=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Max-Age=43200/);
    const value = cookie.split(";")[0]!.slice("counter_merchant=".length);
    expect(verifySession(value, "juniper-clay", KEY)).toBe(true);
  });

  it("refuses other origins and unknown shops", async () => {
    const crossSite = await signIn(request("/api/console/session", { method: "POST", body: { shop: "juniper-clay" }, origin: "https://elsewhere.example" }));
    expect(crossSite.status).toBe(403);
    const unknown = await signIn(request("/api/console/session", { method: "POST", body: { shop: "no-such-shop" }, origin: ORIGIN }));
    expect(unknown.status).toBe(404);
  });

  it("signs out by expiring the cookie", async () => {
    const res = await signOut(request("/api/console/session", { method: "DELETE", origin: ORIGIN }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/counter_merchant=;.*Max-Age=0/);
  });
});
