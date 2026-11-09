import { logEvent, withCartRetry } from "@counter/db";
import {
  checkoutCart,
  createCart,
  getCart,
  replaceCart,
  SCOPES,
  verifyPayPalJwt,
  PAYPAL_JWKS_URL,
  type HandlerResult,
} from "@counter/store-sync";
import { recordAgentRequest } from "@counter/platform";
import { db, loadShop, merchantRef, sandboxKeys, storeSyncDeps } from "@/lib/server/runtime";

type Ctx = { params: Promise<{ shop: string; path?: string[] }> };

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function notFound(path: string): Response {
  return json(404, {
    name: "RESOURCE_NOT_FOUND",
    message: `No Store Sync resource at ${path}`,
    details: [{ field: "path", issue: "NOT_FOUND", description: "Use /merchant-cart, /merchant-cart/{id} or /merchant-cart/{id}/checkout" }],
  });
}

type Route =
  | { op: "create" }
  | { op: "get"; cartId: string }
  | { op: "replace"; cartId: string }
  | { op: "checkout"; cartId: string }
  | null;

function route(method: string, path: string[]): Route {
  if (path[0] !== "merchant-cart") return null;
  if (path.length === 1 && method === "POST") return { op: "create" };
  if (path.length === 2 && method === "GET") return { op: "get", cartId: path[1]! };
  if (path.length === 2 && method === "PUT") return { op: "replace", cartId: path[1]! };
  if (path.length === 3 && path[2] === "checkout" && method === "POST") return { op: "checkout", cartId: path[1]! };
  return null;
}

const EVENT: Record<string, string> = { create: "cart.created", replace: "cart.updated", checkout: "cart.checkout", get: "cart.read" };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { shop: slug, path = [] } = await ctx.params;
  const shop = await loadShop(slug);
  const r = route(req.method, path);

  // Authenticate before routing, so unknown paths still answer 401 to bad tokens.
  const auth = await verifyPayPalJwt(req.headers.get("authorization"), {
    mode: shop?.jwksMode === "paypal" ? "paypal" : "sandbox",
    sandboxKeys: await sandboxKeys(),
    jwksUrl: PAYPAL_JWKS_URL,
    merchantId: shop ? merchantRef(shop) : "unknown",
    requiredScopes: r?.op === "checkout" ? [...SCOPES.checkout] : [...SCOPES.cart],
  });
  if (!auth.ok) return json(auth.status, auth.body);
  if (!shop) return notFound(`/s/${slug}`);
  if (!r) return notFound(`/s/${slug}/paypal/v1/${path.join("/")}`);

  const body = r.op === "get" ? undefined : await req.text();
  const deps = storeSyncDeps();
  const started = Date.now();
  const result: HandlerResult = await withCartRetry(deps, (d) => {
    switch (r.op) {
      case "create":
        return createCart(shop.slug, body, d, auth.clientIdentifier ? { clientIdentifier: auth.clientIdentifier } : {});
      case "get":
        return getCart(shop.slug, r.cartId, d);
      case "replace":
        return replaceCart(shop.slug, r.cartId, body, d);
      case "checkout":
        return checkoutCart(shop.slug, r.cartId, body, d);
    }
  });

  if (r.op !== "get") {
    const out = result.body as { id?: string; status?: string; validation_status?: string; totals?: { total?: { value?: string } }; payment_method?: { token?: string } } | undefined;
    await logEvent(db(), shop.slug, EVENT[r.op]!, out?.id ?? ("cartId" in r ? r.cartId : null), {
      http: result.status,
      status: out?.status,
      validation_status: out?.validation_status,
      total: out?.totals?.total?.value,
      paypal_order_id: out?.payment_method?.token,
      agent: auth.clientIdentifier ?? null,
      ms: Date.now() - started,
    }).catch((err) => console.error("event log failed", err));
    // Keep what the agent asked for, separately from the cart PayPal rewrites, for dispute evidence.
    const cartId = out?.id ?? ("cartId" in r ? r.cartId : undefined);
    if ((r.op === "create" || r.op === "replace") && cartId && result.status < 300) {
      await recordAgentRequest(db(), { shopId: shop.slug, cartId, body, agentClient: auth.clientIdentifier ?? null }).catch((err) =>
        console.error("agent request log failed", err),
      );
    }
  }
  return json(result.status, result.body);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
