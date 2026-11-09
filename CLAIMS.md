# Claims and evidence

Every public claim in [`README.md`](README.md) and [`JUDGES.md`](JUDGES.md), with how to check it.

| Tag | Meaning |
| --- | --- |
| `REPRODUCIBLE` | A command or file in this repo reproduces it. |
| `VERIFIED-LIVE` | You can see it on the deployment at the URL given. |
| `MODELED` | A stand-in, a demo rule or a counterfactual score, not an observation of real commerce. |
| `NOT-CLAIMED` | Something Counter explicitly does not claim. |

Commands run from the repository root after `pnpm install`. Live URLs are on https://counter-agents.vercel.app.

## Live PayPal verification

| What | Status |
| --- | --- |
| PayPal sandbox round trip on the deployment: create AUTHORIZE order, buyer approval, authorize, capture on ship, void and refund, webhooks, dispute evidence, partner onboarding | **Verified live on the sandbox** for the core path: AUTHORIZE order created by the Store Sync API, buyer approval in PayPal, authorize, capture on ship with tracking (JC-10001, LL-10001), void on cancel (NP-10001), partial refund (LL-10001), webhooks received and verified, and a second seller onboarded through Partner Referrals: Juniper Clay is now paid to its own sandbox business account, and JC-10006 was captured to it with `PayPal-Auth-Assertion` and a 2% platform fee to Counter. Order and capture ids: [docs/live-verification.md](docs/live-verification.md). A buyer-raised dispute on JC-10002 (`PP-R-IJG-10197634`, item not received) arrived by webhook and was answered with the tracking number and the evidence PDF, which PayPal shows as submitted by the seller; PayPal's decision is pending. |

## Measured results

| # | Claim | Tag | Evidence |
| --- | --- | --- | --- |
| R1 | On the same 40 registered tasks, the Counter arm spent $0.67 and the storefront + browser arm $3.55 with `openai-gpt-6-sol`; $0.07 against $0.32 with `z-ai-glm-5-3-flash`. | `REPRODUCIBLE` | `node bench/purchase/report.mjs` prints the table from `results/purchase.json` (`summary[].cost_usd`). Re-running the benchmark itself needs a model key: [`bench/purchase/README.md`](bench/purchase/README.md#run-it). |
| R2 | Median tool calls per task: 4 (Counter) against 11.5 (browser) with `openai-gpt-6-sol`; 3 against 10 with `z-ai-glm-5-3-flash`. Median seconds: 14.9 against 44.9; 6.8 against 26.8. | `REPRODUCIBLE` | Same command, `summary[].median_steps`, `summary[].median_seconds`. |
| R3 | "About 3x the steps and about 5x the cost": steps 2.9x and 3.3x, spend 5.3x and 4.8x, time 3.0x and 4.0x (browser over Counter, per model). | `REPRODUCIBLE` | Ratios of the R1 and R2 values in `results/purchase.json`. |
| R4 | Accuracy is a tie on this storefront: browser arm 40/40 and 39/40, Counter arm 39/40 and 40/40 (re-run after a tool fix); 0 wrong buys in any arm; 2 failed runs of 160, both buying nothing. | `REPRODUCIBLE` | `node bench/purchase/report.mjs --failures` |
| R5 | The first Counter-arm run (39/40 for both models, 0 wrong buys) is kept, not overwritten. | `REPRODUCIBLE` | `results/purchase.json`, key `superseded`; [`bench/purchase/README.md`](bench/purchase/README.md#results) |
| R6 | The 40 tasks and their answer key were registered before any run and check out against the 107-variant catalog. | `REPRODUCIBLE` | `node bench/tasks/validate.mjs`; `registered_at` in `bench/tasks/tasks.json`; git history of that file |
| R7 | Negotiation: 120 runs (60 scenarios x 2 models); in the engine arm 0 sales below floor, 0 rule violations, 0 replies that disagree with the deal; 119 offers issued, 0 differ from the deal. | `REPRODUCIBLE` | `node -e "const s=require('./results/negotiation.json').summary; console.log(s.runs, s.below_floor, s.rule_violations, s.mismatches, s.targets)"` |
| R8 | Without the engine, the seller broke a rule once (8% off a single item against the 5% non-bundle limit), and one later proposal would have priced a line below its floor. | `REPRODUCIBLE` (counts), `MODELED` (what would have sold) | `summary.rule_violations.control = 1`, `summary.intercepted.below_floor_proposals = 1` in `results/negotiation.json`; the no-engine and prompt-only arms are scored, never charged ([`bench/negotiation/README.md`](bench/negotiation/README.md#arms)) |
| R9 | 923 tests pass across ten packages, with 3 expected failures and 6 skipped live tests. Per package: store-sync 302, importer 132, gateway 99, platform 91, paypal 86, negotiate 74, db 50, agent 39, bench 25, web 25. | `REPRODUCIBLE` | `pnpm -r test` (no network, no keys) |
| R10 | The Node port of PayPal's "PayPal Agentic Commerce" Postman collection: 166 passed, 3 expected failures. | `REPRODUCIBLE` | `pnpm --filter @counter/store-sync exec vitest run test/conformance.test.ts` |
| R11 | Those 3 assertions contradict the `@paypal/commerce-cart-zod@1.4.0` schema the collection itself loads, so about 149 of 152 is the ceiling for a conforming merchant. | `REPRODUCIBLE` | `it.fails` cases in `packages/store-sync/test/conformance.test.ts`; [`docs/store-sync-conformance.md`](docs/store-sync-conformance.md#three-assertions-that-cannot-pass) |

## Live deployment

| # | Claim | Tag | Evidence |
| --- | --- | --- | --- |
| L1 | The Playground streams a buyer agent's tool calls with the shop's answers. | `VERIFIED-LIVE` | https://counter-agents.vercel.app/playground |
| L2 | `/mcp` is an MCP server with 8 tools, needs no key, serves revision 2026-07-28 and falls back to 2025-11-25 for `initialize`. | `VERIFIED-LIVE` | The `tools/list` curl in [`JUDGES.md`](JUDGES.md#3-connect-your-own-agent-30-s-tech-impact); `server/discover` answers `supportedVersions: ["2026-07-28"]` |
| L3 | Three MCP Apps cards are served as `ui://counter/product.html`, `cart.html`, `approval.html` (`text/html;profile=mcp-app`). | `VERIFIED-LIVE` | `resources/list` on `/mcp`; tests in `packages/gateway/test/apps.test.ts`. Rendering in a production chat client is not claimed (see NOT-CLAIMED). |
| L4 | Storefront pages offer the shop tools to in-page agents (WebMCP). | `VERIFIED-LIVE` | https://counter-agents.vercel.app/mcp?webmcp-script; loaded in `apps/web/app/s/[shop]/(storefront)/layout.tsx` |
| L5 | The live seller agent turns down a fake system notice and returns an offer below list, above floor, valid 30 minutes. | `VERIFIED-LIVE` | The `negotiate` curl in [`JUDGES.md`](JUDGES.md#2-try-to-break-the-shops-rules-45-s-tech-innovation) |
| L6 | The Store Sync route refuses a request without a bearer token (`401 AUTHENTICATION_FAILED`). | `VERIFIED-LIVE` | `curl -s -X POST https://counter-agents.vercel.app/s/juniper-clay/paypal/v1/merchant-cart -d '{}'` |
| L7 | The gateway's public signing key is published. | `VERIFIED-LIVE` | https://counter-agents.vercel.app/.well-known/jwks.json |
| L8 | Three demo shops have storefronts for people. | `VERIFIED-LIVE` | https://counter-agents.vercel.app/s/juniper-clay, https://counter-agents.vercel.app/s/northpaw-roasters, https://counter-agents.vercel.app/s/loop-and-lantern |
| L9 | Studio imports products from a URL, photo or CSV into drafts with a Channel3 market check and a suggested floor. | `VERIFIED-LIVE` | https://counter-agents.vercel.app/studio?shop=juniper-clay |
| L10 | The Console is an AG Studio dashboard with an Agent stream, and its assistant delegates shop questions to the `merchant-ops` agent. | `VERIFIED-LIVE` | https://counter-agents.vercel.app/console?shop=juniper-clay |
| L11 | The Store Sync conformance notes are published. | `VERIFIED-LIVE` | https://counter-agents.vercel.app/docs/store-sync-conformance |

## Implementation

| # | Claim | Tag | Evidence |
| --- | --- | --- | --- |
| P1 | Counter serves the four Store Sync merchant endpoints for every shop at `/s/<shop>/paypal/v1`. | `REPRODUCIBLE` | `apps/web/app/s/[shop]/paypal/v1/[[...path]]/route.ts`, `packages/store-sync/src/handlers.ts`; `packages/store-sync/test/handlers.test.ts`, `dispatch.test.ts` |
| P2 | Every cart request is parsed with `PayPalCartSchema` from `@paypal/commerce-cart-zod@1.4.0`. | `REPRODUCIBLE` | `packages/store-sync/src/validate.ts`, `packages/store-sync/package.json`; `validate.test.ts` |
| P3 | The gateway signs Store Sync calls with the header and claims PayPal's platform uses (RS256, `iss: paypal.com`, scopes, `external_id`); shops verify them, or PayPal's JWKS in `paypal` mode. | `REPRODUCIBLE` | `packages/gateway/src/jwt.ts`, `packages/store-sync/src/auth.ts`; `packages/gateway/test/jwt.test.ts`, `packages/store-sync/test/auth.test.ts` |
| P4 | Each cart gets an Orders v2 order with `intent: AUTHORIZE`; for an onboarded shop it names the shop as payee and sends `PayPal-Auth-Assertion` and `PayPal-Partner-Attribution-Id`. | `REPRODUCIBLE` | `packages/paypal/test/orders.test.ts`, `packages/platform/test/payments.test.ts` |
| P5 | A cart change patches the order; an order PayPal reports expired is replaced. | `REPRODUCIBLE` | `packages/paypal/test/order-lifecycle.test.ts`, `packages/platform/test/payments.test.ts`, `packages/store-sync/src/handlers.ts` |
| P6 | The `checkout` tool reads the buyer's approval with Orders v2 `GET`; Store Sync checkout authorizes the order; an unapproved order leaves the cart open. | `REPRODUCIBLE` | `packages/platform/test/order-lookup.test.ts`, `packages/paypal/test/order-lifecycle.test.ts`, `packages/platform/test/payments.test.ts` |
| P7 | Shipping captures the authorization, adds tracking to the PayPal order, and takes a 2% platform fee only from shops paid to their own PayPal account; repeating it is safe. | `REPRODUCIBLE` | `packages/platform/test/fulfilment.test.ts` (`Fulfilment.ship`), `packages/paypal/test/payments.test.ts`, `tracking.test.ts` |
| P8 | Cancelling before shipment voids the authorization and puts stock back once. | `REPRODUCIBLE` | `packages/platform/test/fulfilment.test.ts` (`Fulfilment.cancel`) |
| P9 | Refunds are full or partial, once. | `REPRODUCIBLE` | `packages/platform/test/fulfilment.test.ts` (`Fulfilment.refund`), `packages/paypal/test/payments.test.ts` |
| P10 | Webhooks are verified with PayPal over the exact bytes and each event id is handled once. | `REPRODUCIBLE` | `packages/paypal/test/webhooks.test.ts`, `packages/platform/test/webhooks.test.ts` |
| P11 | Disputes are decided by rule from the order's record and answered with a generated evidence PDF through `provide-evidence`, or accepted. | `REPRODUCIBLE` | `packages/platform/test/disputes.test.ts`, `packages/paypal/test/disputes.test.ts` |
| P12 | A shop connects its own PayPal account through Partner Referrals v2. | `REPRODUCIBLE` | `packages/paypal/test/partner.test.ts`, `packages/platform/test/onboarding.test.ts` |
| P13 | Vault v3 helpers exist and are tested; no flow uses them. | `REPRODUCIBLE` | `packages/paypal/src/vault.ts`, `packages/paypal/test/vault.test.ts`; no caller outside `packages/paypal` |
| P14 | The pricing engine never crosses a floor, the cap, the small-cart limit or list price. | `REPRODUCIBLE` | `pnpm --filter @counter/negotiate exec vitest run test/engine.test.ts` (includes 5,000 seeded random cases) |
| P15 | A lowball is answered above the floor (floor plus 40% of the gap to list, rounded up to 50 cents), so it never reveals the floor. | `REPRODUCIBLE` | `floorGuard` in `packages/negotiate/src/engine.ts`; `engine.test.ts` |
| P16 | The seller model never sees a floor or a cost, gets buyer text only as quoted data, and every amount in its reply must be an engine number (one rewrite, then a template). | `REPRODUCIBLE` | `packages/negotiate/test/seller.test.ts` |
| P17 | An offer is bound to the agent client, the shop, the exact lines and quantities and a 30-minute expiry, and is applied as a Store Sync cart discount. | `REPRODUCIBLE` | `DEFAULT_TTL_MS` in `packages/negotiate/src/seller.ts`; `packages/negotiate/test/offers.test.ts`, `packages/platform/test/negotiation.test.ts` |
| P18 | The importer builds drafts from a URL, a photo or a CSV; Channel3 runs over its keyless MCP server, or REST when `CHANNEL3_API_KEY` is set. | `REPRODUCIBLE` | `packages/importer/src/channel3/index.ts`; `packages/importer/test/from-url.test.ts`, `from-photo.test.ts`, `from-csv.test.ts`, `channel3-mcp.test.ts`, `channel3-rest.test.ts` |
| P19 | The suggested floor is max(cost x 1.25, price less the maximum discount, market low x 0.9), never above list. | `REPRODUCIBLE` | `packages/importer/src/floor.ts`; `floor.test.ts` |
| P20 | The Console's `ship_order` only prepares a shipment and the capture runs on the merchant's Confirm; `set_floor` is refused below cost x 1.25 or above list. | `REPRODUCIBLE` | `apps/web/lib/console/ai/pending.ts`, `apps/web/lib/console/ai/harness.ts`, `apps/web/lib/console/server/actions.ts` |
| P21 | Console actions and the Console's model proxy accept same-origin requests only, rate limited per address. | `REPRODUCIBLE` | `apps/web/app/api/console/_lib/http.ts`, `apps/web/app/api/console/[shop]/actions/route.ts`, `apps/web/app/api/console/ai/responses/route.ts` |
| P22 | The Playground buyer agent is capped at 16 tool calls a turn and 20 runs per 10 minutes per address, and is told to stop at the PayPal approval link. Whatever an agent does, an order cannot be placed until the buyer approves it in PayPal: checkout authorizes, and PayPal refuses to authorize an unapproved order. | `REPRODUCIBLE` | `apps/web/app/api/playground/route.ts`; `packages/platform/test/payments.test.ts` |
| P23 | The runtime models are `z-ai-glm-5-3-flash` (seller, Playground buyer, importer text and vision) and `openai-gpt-6-luna` / `openai-gpt-61-terra` (Console), through Venice AI. | `REPRODUCIBLE` | `apps/web/lib/server/runtime.ts`, `apps/web/app/api/playground/route.ts`, `packages/importer/src/config.ts`, `apps/web/lib/console/ai-config.ts` |
| P24 | The Console is built on AG Studio 3.1.0 with three custom widgets. | `REPRODUCIBLE` | `apps/web/package.json`, `apps/web/components/console/widgets/index.ts` |
| P25 | The PayPal client is pinned to the sandbox, and the benchmark switches refuse to run on Vercel. | `REPRODUCIBLE` | `SANDBOX_BASE` and `localOnly` in `apps/web/lib/server/runtime.ts` |

## Modeled

| # | Claim | Tag | Evidence |
| --- | --- | --- | --- |
| M1 | Juniper Clay (Rosa Marín, Portland), Northpaw Roasters and Loop & Lantern are demo shops with a seeded catalog; the README's scene is illustrative. | `MODELED` | `packages/db/src/seed/catalog.json` |
| M2 | The gateway plays PayPal's agentic platform in sandbox: its tokens follow PayPal's token shape but are signed by Counter's key, not issued by PayPal. | `MODELED` | `packages/gateway/src/jwt.ts`, `packages/gateway/src/keys.ts` |
| M3 | The 2% platform fee is Counter's own setting, not a PayPal price. | `MODELED` | `DEFAULT_PLATFORM_FEE_BPS = 200` in `packages/platform/src/fulfilment.ts` |
| M4 | Tax (flat 7.25%, 0% in OR, MT, NH, DE) and shipping (US only; $5.99 standard, free from $75; $14.99 express) are demo rules. | `MODELED` | `packages/store-sync/src/tax.ts`, `packages/store-sync/src/shipping.ts` |
| M5 | In the purchase benchmark, payment is stubbed in both arms and the store clock and stock are controlled. | `MODELED` | [`MOCKS.md`](MOCKS.md), [`bench/purchase/README.md`](bench/purchase/README.md#environment) |
| M6 | Benchmark spend is what the model provider reported per call. | `MODELED` | `runs[].cost_usd` in `results/purchase.json`; `spend_usd` in `results/negotiation.json` |

## Not claimed

| # | Counter does not claim | Tag |
| --- | --- | --- |
| N1 | That Counter makes agents more accurate than a browser agent on a well-built store. On our storefront, accuracy was a tie. | `NOT-CLAIMED` |
| N2 | Anything about how browser agents fare on real merchant websites. The benchmark storefront is Counter's own clean, accessible store, the best case for browser agents. | `NOT-CLAIMED` |
| N3 | Production PayPal traffic, or a dispute decided by PayPal: the sandbox dispute is answered and under PayPal's review (see Live PayPal verification). | `NOT-CLAIMED` |
| N4 | Real money. Everything runs on the PayPal sandbox. | `NOT-CLAIMED` |
| N5 | Onboarding to PayPal's Store Sync program, or traffic from PayPal's agentic commerce platform. The Console's labels for Perplexity, Copilot and Meta AI map `Client_Identifier` values; they are not observed traffic. | `NOT-CLAIMED` |
| N6 | UCP integration. | `NOT-CLAIMED` |
| N7 | MCP Apps cards working in a production chat client. They have been rendered in a stand-in host only. | `NOT-CLAIMED` |
| N8 | Robustness to multi-turn negotiation pressure. The negotiation benchmark is single-turn. | `NOT-CLAIMED` |
| N9 | That prompt rules alone fail on this scenario set. The prompt-only arm also sold nothing below floor in the reported run. | `NOT-CLAIMED` |
| N10 | Merchant authentication. The Console is demo-grade: same-origin checks and rate limits only. | `NOT-CLAIMED` |
| N13 | That the demo shops' floors are secret from people. The Console's data API serves floors and costs only to a merchant session (`apps/web/test/console-routes.test.ts`), but the demo hands that session to anyone who clicks "View as Rosa". What Counter claims is that buyer agents and the seller model never receive floors or costs (P16, and `packages/platform/test/directory.test.ts`). | `NOT-CLAIMED` |
| N11 | Saved PayPal wallets (Vault v3) in any flow. | `NOT-CLAIMED` |
| N12 | Any endorsement by PayPal, Channel3, AG Grid or a model provider. | `NOT-CLAIMED` |
