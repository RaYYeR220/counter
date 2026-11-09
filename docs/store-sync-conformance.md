# Store Sync conformance

Counter implements the merchant side of PayPal's Store Sync Cart API: the four endpoints PayPal's agentic commerce platform calls on a merchant's server.

| Method | Path | Counter route |
| --- | --- | --- |
| POST | `/merchant-cart` | `/s/<shop>/paypal/v1/merchant-cart` |
| GET | `/merchant-cart/{id}` | `/s/<shop>/paypal/v1/merchant-cart/{id}` |
| PUT | `/merchant-cart/{id}` | `/s/<shop>/paypal/v1/merchant-cart/{id}` |
| POST | `/merchant-cart/{id}/checkout` | `/s/<shop>/paypal/v1/merchant-cart/{id}/checkout` |

Every response is validated against PayPal's own schema package, `@paypal/commerce-cart-zod@1.4.0`, the version PayPal's Postman collection pins.

## How we check it

PayPal publishes a Postman collection ("PayPal Agentic Commerce", workspace `paypal-agentic-commerce-workspace`, updated 2026-05-07) that exercises a merchant's Cart API: 18 requests and about 152 assertions per full run. Counter runs the same checks two ways:

1. **In the test suite.** `packages/store-sync/test/conformance.test.ts` replays the collection in its run order, with the collection's own request bodies, `{{variable}}` substitution and the RS256 token its pre-request script signs. Every request goes through JWT verification and then the handlers. Each `describe` block is named after the Postman request it mirrors. The collection-level checks (C1–C8) run on every non-error response, and the error-folder checks run on the error scenarios.
2. **Against the deployed API.** The collection itself, run with the Postman CLI against `https://counter-agents.vercel.app/s/juniper-clay/paypal/v1`, with a sandbox buyer approving the two PayPal orders the run creates.

The collection uses `pm.require('npm:…')` for `jsonwebtoken` and the zod schemas. Newman does not resolve those packages, so use the Postman app or the Postman CLI.

## Three assertions that cannot pass

Three assertions in the collection contradict the schema the collection itself loads. Counter follows the schema in each case, because PayPal's platform parses carts with that schema.

1. **"Response contains only recognized PayPalCart properties" on both checkouts.** A successful checkout must return `payment_confirmation` (`merchant_order_number`, `order_review_page`), but `PayPalCartSchema.strict()` in 1.4.0 has no `payment_confirmation` key, so the strict check fails on every checkout. The collection labels this check "for awareness". Counter's tests assert that `payment_confirmation` is the only extra key on checkout responses and that no other response carries any extra key.
2. **SHIPPING_NOT_AVAILABLE.** The error test accepts only `SHIPPING_NOT_AVAILABLE` or `SHIPPING_ADDRESS_UNSERVICEABLE`, and neither value exists in any `specific_issue` enum of the schema. A response carrying either code fails the schema check in the same test. Counter answers an address it cannot ship to with the schema-valid `SHIPPING_ERROR` / `INTERNATIONAL_SHIPPING_RESTRICTED`.
3. **The checkout latency check never runs.** It is gated on URLs matching `/complete$/`, while the checkout path is `/merchant-cart/{id}/checkout`. Counter still holds the documented limit: checkout under 5 s.

So the realistic ceiling for a conforming merchant is about 149 of 152 assertions.

### Suggested fixes for the collection

- Add `payment_confirmation` to the strict check for checkout responses, or validate checkout with `PayPalCartSchema.extend({ payment_confirmation: … }).strict()`.
- Accept `INTERNATIONAL_SHIPPING_RESTRICTED`, `SHIPPING_ZONE_NOT_COVERED` and `REGION_RESTRICTED` in the SHIPPING_NOT_AVAILABLE test, or add the two expected codes to the schema enums.
- Match the latency check on `/checkout$/`.
- The Oregon edge case uses `{{parent_id}}` / `{{variant_id}}`, which are not defined in the collection's variables (they are `item_parent_id` / `item_variant_id`).

## Other spec details Counter settles

| Question | What Counter does | Why |
| --- | --- | --- |
| `payment_method.type` casing | lowercase `paypal` | The schema enum is lowercase; uppercase examples in the docs fail validation. |
| Create with validation issues | `200`, not `201` | The collection requires exactly 200. |
| Unknown items mixed with known ones | `200 INCOMPLETE`, every item echoed, one issue per bad item with its `variant_id` | MULTI_ITEM_ERRORS checks every issue's `variant_id` appears in `items`. |
| No item can be priced | `422` with `business_context` at the top level and on every detail | The schema and the collection read it per detail; the OpenAPI document reads it at the top level. |
| Completed cart, checkout again | Same token: the stored response is replayed. Different token: `422 PAYMENT_DECLINED` | Retries stay idempotent; PAYMENT_DECLINED test. |
| Scope or merchant mismatch in the token | `401 INSUFFICIENT_PERMISSIONS` | The OpenAPI document defines only 401 for auth failures. |
| Self-signed sandbox tokens | Verified against the configured sandbox key regardless of `kid` | PayPal's sandbox tokens reuse the production `kid`. |
| Payment intent | Orders v2 `AUTHORIZE`; checkout authorizes, the shop captures when it ships | Physical goods are paid for when they ship; the checkout response is the same. |
