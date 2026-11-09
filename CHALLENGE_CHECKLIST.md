# Challenge checklist

Each judging criterion and each requirement, with the exact evidence. Claim numbers (R, L, P, M, N) refer to [`CLAIMS.md`](CLAIMS.md); the 5-minute review path is [`JUDGES.md`](JUDGES.md).

## Live PayPal verification

| What | Status |
| --- | --- |
| PayPal sandbox round trip on the deployment: create AUTHORIZE order, buyer approval, authorize, capture on ship, void and refund, webhooks, dispute evidence, partner onboarding | **Verified live on the sandbox** for the core path: AUTHORIZE order created by the Store Sync API, buyer approval in PayPal, authorize, capture on ship with tracking (JC-10001, LL-10001), void on cancel (NP-10001), partial refund (LL-10001), webhooks received and verified, and a second seller onboarded through Partner Referrals: Juniper Clay is now paid to its own sandbox business account, and JC-10006 was captured to it with `PayPal-Auth-Assertion` and a 2% platform fee to Counter. Order and capture ids: [docs/live-verification.md](docs/live-verification.md). A buyer-raised dispute is covered by fixture tests and not yet run live. |

## Requirements

| Requirement | Met by | Evidence |
| --- | --- | --- |
| PayPal technology meaningfully integrated | The merchant side of PayPal's Store Sync Cart API for every shop, validated with PayPal's own `@paypal/commerce-cart-zod@1.4.0` and replayed against PayPal's Postman collection; Orders v2 AUTHORIZE, PATCH, authorize and tracking; Payments v2 capture with platform fee, void, refund; webhook verification; Disputes with evidence upload; Partner Referrals onboarding with `PayPal-Auth-Assertion` and BN code; Vault v3 helpers. Built on `@paypal/paypal-server-sdk` 2.5. | [README: PayPal Developer Platform usage](README.md#paypal-developer-platform-usage); `packages/store-sync`, `packages/paypal`, `packages/platform`; `pnpm -r test` (R9); `pnpm --filter @counter/store-sync exec vitest run test/conformance.test.ts` (R10); [`docs/store-sync-conformance.md`](docs/store-sync-conformance.md); claims P1 to P13 |
| AI meaningfully integrated | A seller agent negotiates for each shop under a deterministic pricing engine; a buyer agent shops through MCP in the Playground; vision and text models turn product pages, photos and CSVs into agent-legible catalogs; a `merchant-ops` agent runs the shop from the Console. Models named per role. | [README: AI usage](README.md#ai-usage); `packages/negotiate`, `packages/agent`, `packages/importer`, `apps/web/lib/console/ai/harness.ts`; negotiation benchmark (R7, R8); claims P14 to P23 |
| Working prototype judges can run | Live deployment, no sign-in and no key; any MCP client can connect; the whole repo runs locally with one test command. | https://counter-agents.vercel.app/playground, `{"mcpServers":{"counter":{"url":"https://counter-agents.vercel.app/mcp"}}}`, https://counter-agents.vercel.app/s/juniper-clay, https://counter-agents.vercel.app/studio?shop=juniper-clay, https://counter-agents.vercel.app/console?shop=juniper-clay (claims L1 to L11); [README: Run locally](README.md#run-locally); `pnpm -r test` |
| Public repository with a license | This repository, MIT license. | [`LICENSE`](LICENSE) |
| Video | Not linked yet. | |

## Judging criteria

### Technological implementation: PayPal Developer Platform and AI

| Evidence | Where |
| --- | --- |
| Store Sync merchant Cart API, four endpoints, token checked before routing | `packages/store-sync`, `apps/web/app/s/[shop]/paypal/v1/[[...path]]/route.ts`; live 401 without a token (L6) |
| PayPal's schema package and Postman collection used as the test oracle; 3 assertions in the collection shown to contradict its own schema | `packages/store-sync/test/conformance.test.ts` (166 passed, 3 expected failures); [`docs/store-sync-conformance.md`](docs/store-sync-conformance.md) |
| Gateway that signs Store Sync calls the way PayPal's platform does, with a public JWKS | `packages/gateway/src/jwt.ts`; https://counter-agents.vercel.app/.well-known/jwks.json |
| Full payment lifecycle on Orders v2 and Payments v2: authorize at checkout, capture on shipment with tracking and platform fee, void, refund, idempotent with `PayPal-Request-Id` | `packages/paypal`, `packages/platform/src/fulfilment.ts`; P4 to P9 |
| Webhooks with signature verification and per-event dedupe; disputes decided by rule with an evidence PDF | `packages/platform/src/webhooks.ts`, `packages/platform/src/disputes.ts`; P10, P11 |
| Multi-merchant: Partner Referrals onboarding, payee, `PayPal-Auth-Assertion`, BN code | `packages/paypal/src/partner.ts`, `packages/platform/src/onboarding.ts`; P12 |
| MCP server on the current revision with MCP Apps cards and a WebMCP bridge | `apps/web/app/mcp/route.ts`, `packages/gateway/src/apps`; L2 to L4 |
| AI with code-enforced guardrails: engine has the final word, floors never reach the model, reply amounts checked against the deal | `packages/negotiate`; `packages/negotiate/test/seller.test.ts`, `engine.test.ts`; R7, P14 to P16 |
| 918 passing tests, no network or keys needed | `pnpm -r test` (R9) |

### Design

| Evidence | Where |
| --- | --- |
| Playground shows each tool call as a card with the shop's answer, live | https://counter-agents.vercel.app/playground |
| Storefront built for people and agents alike: every option a labelled choice, stock on each option, delivery dates on the page | https://counter-agents.vercel.app/s/juniper-clay |
| Studio walks a shop through five setup steps; imports land as editable drafts with market data and a floor the merchant can check by hand | https://counter-agents.vercel.app/studio?shop=juniper-clay; `packages/importer/src/floor.ts` |
| Console on AG Studio with three custom widgets and an assistant that prepares but never captures without the merchant's Confirm | https://counter-agents.vercel.app/console?shop=juniper-clay; `apps/web/components/console/widgets`; P20 |
| MCP Apps cards for product, cart and checkout; hosts without card support get the same text and structured output | `packages/gateway/src/apps`; L3 |
| Failures are named, not crashes: e.g. `PAYMENTS_NOT_CONNECTED`, `NEGOTIATION_UNAVAILABLE`, `paypal_refused` | `apps/web/lib/server/runtime.ts`, `packages/gateway/src/tools.ts`, `apps/web/app/api/merchant/_lib/http.ts` |

### Potential impact

| Evidence | Where |
| --- | --- |
| Agents doing the same 40 shopping tasks through Counter used about a third of the tool calls and a fifth of the model spend of a browser agent, at the same accuracy | [README: Benchmarks](README.md#benchmarks); R1 to R4 |
| A small shop needs no agent-specific API: Counter speaks PayPal's own Store Sync contract, so the same shop is ready for PayPal's agentic platform once onboarded | `packages/store-sync`; [`docs/architecture.md`](docs/architecture.md#not-wired) |
| A shop gets from a product page, photo or spreadsheet to an agent-ready catalog | Studio (L9); `packages/importer` |
| Disputes from agent purchases can be answered with what the agent itself asked for | `packages/platform/src/disputes.ts`; P11 |
| Honest scope: the measured advantage is effort, not accuracy, on a clean store | N1, N2 |

### Innovation

| Evidence | Where |
| --- | --- |
| Agent-to-agent negotiation where a model talks and a deterministic engine decides; a lowball is answered above the floor so it never reveals it | `packages/negotiate/src/engine.ts`; P14, P15 |
| Negotiated offers bound to the agent, the exact lines and an expiry, flowing into Store Sync cart `discounts` and the PayPal order's `breakdown.discount` | `packages/negotiate/src/offers.ts`, `packages/platform/src/payments.ts`; P17 |
| A gateway that plays PayPal's agentic platform in sandbox, so any MCP client exercises the exact merchant contract today | `packages/gateway`; M2 |
| Conformance findings on PayPal's own Postman collection, with suggested fixes | [`docs/store-sync-conformance.md`](docs/store-sync-conformance.md#suggested-fixes-for-the-collection) |
| Pre-registered benchmarks with a no-engine and a prompt-only control | [`bench/tasks/README.md`](bench/tasks/README.md), [`bench/negotiation/README.md`](bench/negotiation/README.md) |

### Presentation

| Evidence | Where |
| --- | --- |
| README with a measured headline, a 2-minute try-it, the protocol path and every environment variable | [`README.md`](README.md) |
| A timed review path tagged by criterion | [`JUDGES.md`](JUDGES.md) |
| Every claim tagged reproducible, live, modeled or not claimed | [`CLAIMS.md`](CLAIMS.md) |
| Architecture diagram that marks what is not wired | [`docs/architecture.md`](docs/architecture.md) |
| Benchmark methods, failures and limits written up, including the superseded first run | [`bench/purchase/README.md`](bench/purchase/README.md), [`bench/negotiation/README.md`](bench/negotiation/README.md) |
| Everything stubbed, and why | [`MOCKS.md`](MOCKS.md) |
| Video | Not linked yet. |
