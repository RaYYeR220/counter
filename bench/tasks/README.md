# Shopping benchmark: registered task set

Does a shopping agent buy the right thing? Visa's Agentic Commerce Benchmark (Nov 5, 2026) found that shopping agents failed 42.8% of runs, and 54% of the failed runs still ended in a purchase. A wrong purchase costs a small shop more than a missed one: a refund, a return label, and a customer who now distrusts the shop.

This benchmark asks the same question of three demo shops (`packages/db/src/seed/catalog.json`): Juniper Clay (pottery), Northpaw Roasters (coffee) and Loop & Lantern (hand-dyed yarn). They hold 107 variants, including seconds that look like firsts, decaf that looks like regular, dye lots that must match, made-to-order lead times, a subscription that can't be bought once, and sold-out options next to in-stock ones.

## Two arms, one model

| Arm | The agent gets |
| --- | --- |
| Storefront | The shop's normal web pages and a standard browser tool. |
| Counter | Counter's agent tools for the same shop (`search_products`, `get_product`, `create_cart`, `update_cart`, `checkout`, `order_status`). |

Both arms use the same model, the same system prompt, the same task prompt and the same shipping address. Only the way into the shop differs.

## Registration

`tasks.json` was fixed on `registered_at` (2026-11-09), before any run, and is not edited after. That covers all 40 prompts, the answer key and the targets. If a task turns out to be wrong, it is reported as wrong; it is not quietly fixed.

## Store rules every run uses

- The store clock is pinned to Tue 2026-11-10, and stock resets to the seed before every run.
- Runs use list prices. Neither arm gets a negotiation tool.
- Shipping is US only. STANDARD is $5.99, free when the subtotal is above $75.00, and arrives 5 business days after the order ships. EXPRESS is $14.99 and arrives 2 business days after it ships.
- An order ships after the shop's `handling_days` (business days). A variant with `lead_time_days` waits that many calendar days first. Business days are Mon–Fri.
- Tax is 7.25% of (subtotal + shipping), rounded half-up to the cent. OR, MT, NH and DE pay 0%.
- The purchase is whatever the agent takes through checkout. A run that ends without checking out made no purchase.

## Grading

Each run gets exactly one outcome:

| Outcome | When |
| --- | --- |
| Correct buy | Key is `BUY`, the order's lines match the key exactly (same variants, same quantities, nothing extra), and when `max_total` is set, the charged total is not above it. |
| Correct no-buy | Key is `NO_BUY` and the agent made no purchase. |
| Wrong buy | Any purchase on a `NO_BUY` task, or a purchase on a `BUY` task that is not a correct buy. |
| Missed buy | Key is `BUY` and the agent made no purchase. |

A run is CORRECT when it is a correct buy or a correct no-buy. Wrong buys are counted separately, because they are the failures that cost money.

## Targets (pre-registered)

For the Counter arm, `targets` in `tasks.json` fixes:

- `counter_correct_min: 38`, so at least 38 of 40 tasks correct;
- `counter_wrong_buys_max: 0`, so no wrong buys at all.

The storefront arm has no target. It is the baseline, reported as measured.

## The 40 tasks

| Category | Count | What it tests |
| --- | --- | --- |
| `exact_variant` | 10 | Find one variant from a plain request ("the green one" = sage). |
| `quantity` | 5 | Packs vs singles, stock caps, yardage math. |
| `bundle` | 5 | Several lines in one cart. |
| `budget` | 5 | A cap that includes shipping and tax. |
| `constraint` | 5 | Deliver-by dates, decaf, matching dye lots. |
| `should_not_buy` | 7 | Sold out, not offered, subscription-only, too slow, over budget. |
| `trap` | 3 | Seconds vs firsts, decaf look-alikes, the wrong grind. |

Each task has exactly one correct outcome under the rules above. 31 tasks are `BUY` and 9 are `NO_BUY`.

## Schema

```text
{ version, registered_at, targets: { counter_correct_min, counter_wrong_buys_max }, tasks: [
  { id: "T01".."T40",
    shop: catalog shop slug,
    category: exact_variant | quantity | bundle | budget | constraint | should_not_buy | trap,
    prompt: what the shopper tells their agent,
    shipping_address: { address_line_1, admin_area_2 (city), admin_area_1 (state), postal_code, country_code: "US" },
    expected: { decision: "BUY", lines: [{ variant_id, quantity }], max_total: "0.00" | null }
            | { decision: "NO_BUY", reason: out_of_stock | not_offered | over_budget | not_purchasable | lead_time },
    notes: why the task is tricky. Budget totals and deliver-by dates are written out here. } ] }
```

## Checking the key

```sh
node bench/tasks/validate.mjs
```

The script needs no dependencies. It loads both files and checks every task against the catalog. Every key line must name a real variant with enough stock, budget totals must be recomputed to the cent and fit `max_total`, every stock figure quoted in `notes` must match the catalog, `NO_BUY` reasons must be backed by it, and deliver-by dates must hold. It prints a summary table and exits non-zero on any problem.
