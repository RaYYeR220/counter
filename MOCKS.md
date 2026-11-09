# Mocks and stand-ins

Everything Counter fakes, where, and why. Production runs none of these.

## Stub payments for the purchase benchmark

- **Where:** `apps/web/lib/server/runtime.ts`, switched on by `PAYMENTS_MODE=stub`. `COUNTER_CLOCK=<ISO time>` pins the store clock in the same file.
- **What it does:** replaces PayPal for Store Sync carts. Each cart gets a deterministic order id (`STUB-<cart id>`), every order reads as approved by one fixed payer (`BENCHPAYER01`), and authorization always succeeds. Carts, stock, pricing, tax, shipping and order booking are the real code against a real database.
- **Why:** `bench/purchase` measures whether an agent buys the right thing, not whether a person approves a PayPal payment. Without the stub every Counter-arm run would stop at the approval link. The storefront arm records its checkout instead of opening PayPal (bench capture mode, `/api/bench/capture`), so neither arm touches PayPal.
- **Guard:** both switches throw when `VERCEL` is set, so a deployment can never run with them. The benchmark uses its own database (`counter-bench`), never the production one.
