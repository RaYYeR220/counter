# Live PayPal verification

Runs against the deployment at `https://counter-agents.vercel.app` on the PayPal sandbox (2026-11-09, UTC). Every order below was created by a buyer agent through Counter's MCP server, priced and stored by the shop's Store Sync Cart API, and paid with PayPal Orders v2. The buyer approval step was done by a sandbox buyer account in PayPal's own checkout.

| Order | Path | PayPal result |
| --- | --- | --- |
| JC-10001, 3 × speckled mug 8 oz (Juniper Clay → San Jose, CA) | MCP `create_cart` → Store Sync `POST /merchant-cart` (cart `CART-XEYG537I2S`) → PayPal order `2J98877994982915E` (intent `AUTHORIZE`) → buyer approved → MCP `checkout` → Store Sync `/checkout` → authorization `29D708071K9401119` → merchant ships (USPS) | Capture `7YR27244AP1322139` `COMPLETED`, $96.53 (net to merchant $92.67); tracker on the PayPal order `SHIPPED` |
| NP-10001, 2 × Night Shift Decaf 250 g (Northpaw Roasters → New York, NY) | Same path, cart `CART-EDDH14BRK7`, PayPal order `8JM22404854368226` → authorized → merchant cancels | Authorization `7P3836146L709891W` `VOIDED`; stock returned to the shop |
| LL-10001, 2 × Harbor fingering L117 5-pack (Loop & Lantern → Austin, TX), on Counter's PayPal platform app | Same path, cart `CART-0XJ36NQNDZ`, PayPal order `8YG26548EC4374733` → authorized → merchant ships (UPS) → merchant refunds $10.00 | Capture `8T652271LN315573S` `COMPLETED`, $278.85; refund `86N86731BF931094E`, $10.00; PayPal webhooks `CHECKOUT.ORDER.APPROVED` and `PAYMENT.AUTHORIZATION.CREATED` received, signature-verified and recorded |

Also verified live with the same credentials: Vault v3 setup tokens (`POST /v3/vault/setup-tokens` returns an approval link) and Partner Referrals (`POST /v2/customer/partner-referrals` returns a seller onboarding link).

## Not yet verified live

- Seller onboarding completed by a second business account (payee + `PayPal-Auth-Assertion` + 2% platform fee on capture). The onboarding link is issued; the seller's consent step has not been run.
- A buyer-raised dispute answered with the evidence PDF. Covered by fixture tests in `packages/platform`; PayPal's sandbox dispute API needs buyer impersonation rights the app does not have, so the dispute has to be opened by the sandbox buyer in PayPal's own UI.
- PayPal's Postman collection run against the deployment. The Node port of the collection passes in the test suite (166 passed, 3 expected failures; see [store-sync-conformance.md](store-sync-conformance.md)).

The PayPal sandbox UI shows these orders to the sandbox merchant and buyer accounts; the ids above can be looked up with `GET /v2/checkout/orders/{id}` using the platform's sandbox credentials.
