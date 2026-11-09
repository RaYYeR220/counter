# Mocks and stand-ins

Everything Counter fakes, where, and why. Production runs none of the benchmark stubs in the first section; the stand-ins in the second section are part of the deployment and are listed so nothing is hidden.

## Stub payments for the purchase benchmark

- **Where:** `apps/web/lib/server/runtime.ts`, switched on by `PAYMENTS_MODE=stub`. `COUNTER_CLOCK=<ISO time>` pins the store clock in the same file.
- **What it does:** replaces PayPal for Store Sync carts. Each cart gets a deterministic order id (`STUB-<cart id>`), every order reads as approved by one fixed payer (`BENCHPAYER01`), and authorization always succeeds. Carts, stock, pricing, tax, shipping and order booking are the real code against a real database.
- **Why:** `bench/purchase` measures whether an agent buys the right thing, not whether a person approves a PayPal payment. Without the stub every Counter-arm run would stop at the approval link. The storefront arm records its checkout instead of opening PayPal (bench capture mode, `/api/bench/capture`), so neither arm touches PayPal.
- **Guard:** both switches throw when `VERCEL` is set, so a deployment can never run with them. The benchmark uses its own database (`counter-bench`), never the production one.

## Stand-ins on the deployment

### The gateway plays PayPal's agentic platform

- **Where:** `packages/gateway` (signing), `apps/web/lib/server/runtime.ts` (`sandboxKeys`, `storeSyncClient`).
- **What it does:** Counter's MCP server reaches each shop's Store Sync Cart API through a gateway that signs every call with the header and claims PayPal's platform uses, but with Counter's own key (public at `/.well-known/jwks.json`) instead of PayPal's.
- **Why:** real agent traffic from PayPal needs Store Sync onboarding (US merchants, physical goods, USD, by application). The gateway lets any MCP client exercise the same merchant contract in sandbox.
- **Guard:** a shop set to `jwksMode: paypal` accepts only tokens that verify against PayPal's JWKS (`packages/store-sync/src/auth.ts`); gateway tokens are accepted only in `sandbox` mode.

### Demo shops sell through the platform's PayPal account

- **Where:** `merchantRef` and `shopAccounts` in `apps/web/lib/server/runtime.ts`; Studio (`apps/web/components/studio/StudioView.tsx`).
- **What it does:** Northpaw Roasters and Loop & Lantern have no PayPal account of their own. Their tokens name a stable placeholder merchant (`COUNTER-<SLUG>`), their orders are paid to the platform's sandbox account, and no platform fee is taken. Juniper Clay is connected to its own sandbox business account through Partner Referrals, so its orders name that account as `payee` and pay Counter a 2% platform fee on capture. Test shops created in Studio can connect their own sandbox account the same way.
- **Why:** every visitor sees the same three shops without a PayPal signup.

### Merchant sign-in

- **Where:** `apps/web/app/api/merchant/_lib/http.ts` (`requireMerchant`), `apps/web/app/api/console/_lib/http.ts` (`sameOrigin`, `allow`).
- **What it does:** there are no merchant accounts. The merchant REST API (`/api/merchant/*`, `/api/onboarding/start`, `/api/studio/*`) needs one shared key in the `x-merchant-key` header (`MERCHANT_DEMO_KEY`). Console actions accept same-origin requests only, with a per-address rate limit kept in memory. The Console's data API (`/api/console/<shop>/*`, except the public `summary`) needs a merchant session cookie that the demo Console grants with one click ("View as Rosa (demo merchant)"); there is no real merchant sign-in. The MCP tools and the seller model never receive floors or costs.
- **Why:** a public demo where anyone can try the merchant side. It is not access control for a real shop.

### Default buyer on MCP carts

- **Where:** `apps/web/app/mcp/route.ts` (`defaultCustomer`), used in `packages/gateway/src/tools.ts`.
- **What it does:** when an agent does not pass a customer, the cart names "Sandbox Buyer" with `DEMO_BUYER_EMAIL` (default `buyer@counter-demo.example`). Whoever approves the payment in PayPal is the payer.

### Webhook simulator

- **Where:** `SIMULATOR_WEBHOOK_ID` in `packages/platform/src/webhooks.ts`.
- **What it does:** with `PAYPAL_WEBHOOK_ID=WEBHOOK_ID`, deliveries from PayPal's webhook simulator, which carry no verifiable signature, are processed and recorded as unverified. With any other id, every delivery is verified with PayPal.
- **Guard:** only when configured that way; never for a production webhook.

### Console demo activity (optional, not on the deployment)

- **Where:** `apps/web/scripts/seed-console-demo.ts`.
- **What it does:** seeds a week of plausible agent activity into a development database so the Console has something to show. Every row it writes is marked as demo data, and `--reset` removes exactly those rows.
- **Guard:** it reads `SEED_DATABASE_URL`, never `DATABASE_URL`. The deployment's Console shows its own traffic only (`includesDemo: false` in `/api/console/<shop>/summary`).
