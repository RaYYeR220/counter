# Purchase benchmark: does the agent buy the right thing?

Visa's Agentic Commerce Benchmark (Nov 5, 2026) found that shopping agents failed 42.8% of runs, and 54% of the failed runs still ended in a purchase. For a small shop a wrong purchase is the expensive failure: a refund, a return label, and a customer who stops trusting the shop.

This benchmark asks one question: **given the same model and the same request, does an agent buy the right thing more often through Counter than through the shop's website?**

## Two arms, one model

| Arm | The agent gets |
| --- | --- |
| Storefront + browser | The shop's normal web pages (`/s/<shop>`) and a standard browser tool: Playwright MCP (`@playwright/mcp@0.0.83`, headless, fresh profile per run). |
| Counter tools | Counter's MCP server (`/mcp`) for the same shop: `search_products`, `get_product`, `create_cart`, `update_cart`, `checkout`, `order_status`. |

Everything else is identical: the model, temperature 0, a 40-tool-call cap, the user prompt and shipping address from the registered task, and the system prompt except for one line:

> You are a shopping agent acting for a user. Buy exactly what they ask for from {shop}, shipping to the address they give. If the exact item can't be bought, don't buy anything and explain why. The user can't answer questions during this task and has already approved the purchase: when the cart matches their request, complete the checkout yourself. Payment approval is handled for you. When you are done, reply with a short summary of what you bought, or why you bought nothing.
>
> Storefront: *Use the browser tools. Start at http://localhost:3105/s/{shop}.*
> Counter: *Use the shop tools. The shop's slug is {shop}.*

The tasks are the 40 registered in [`bench/tasks/tasks.json`](../tasks/tasks.json) before any run (see [`bench/tasks/README.md`](../tasks/README.md)). The key was not changed after registration.

## Environment

Both arms shop the same local Counter server (`next start`) on its own database (`counter-bench`), so no production data is touched.

- **Store clock** pinned to Tue 2026-11-10 15:00 UTC (`COUNTER_CLOCK`), so delivery dates are the same on every run.
- **Stock** reset to the seed before every run. Counter-arm runs place real orders, which take stock, so each shop runs one Counter-arm task at a time and reseeds in between. Storefront checkouts are recorded rather than booked, so stock never moves in that arm.
- **List prices only.** Neither arm has a negotiation tool.
- **Payment is stubbed, in both arms.** Payment is not what is measured, and a real PayPal approval needs a person. With `PAYMENTS_MODE=stub` the server approves and authorizes every Counter order with deterministic ids. The storefront runs in capture mode (a `counter_bench_run` cookie set per run): its "Checkout with PayPal" button records the cart, address and priced total instead of opening PayPal, then moves on to a "handed to PayPal" page, the way a real checkout leaves the shop for PayPal. Both switches are refused on Vercel; see [`MOCKS.md`](../../MOCKS.md).
- **A step** is one tool call. Both arms stop at 40.
- **What the model sees.** Tool outputs are shortened to 24,000 characters (start and end kept), and outputs over 6,000 characters are replaced by a one-line note once two newer ones exist. In practice this keeps the two most recent page snapshots in the storefront arm; Counter's outputs are almost always under the limit. Full outputs are kept in the traces.
- The browser runs with `--no-webmcp`, so the storefront arm cannot pick up tools a page registers for agents. It is a plain browser on a plain storefront.

## Grading

Exactly as registered. The purchase is what went through checkout: for the Counter arm, the carts whose `checkout` completed; for the storefront arm, the checkouts the storefront captured for that run (a double submit of the same cart counts once; different carts add up, as separate orders would).

| Outcome | When |
| --- | --- |
| Correct buy | Key is `BUY`, the purchase lines match the key exactly (variant and quantity, nothing extra), and the total is within `max_total` when set. |
| Correct no-buy | Key is `NO_BUY` and nothing was bought. |
| Wrong buy | Anything bought on a `NO_BUY` task, or a purchase on a `BUY` task that is not exactly right. |
| Missed buy | Key is `BUY` and nothing was bought. |

`grade.mjs` and `outcome.mjs` are pure functions with tests (`pnpm --filter @counter/bench test`).

## Models

Two models, both through Venice AI's OpenAI-compatible API at temperature 0: a small, fast model, and a larger one picked by a smoke test. Two larger models ran three tasks in both arms; both got all six right, and the one kept had no tool-call errors and cost about half as much. The budget allowed all 40 tasks for both models, so no subset was needed. A six-task pilot on the small model was used to debug the harness and is not part of the results.

## Results

160 runs: 2 models × 2 arms × 40 tasks, one run each. Printed by `node bench/purchase/report.mjs --failures` from [`results/purchase.json`](../../results/purchase.json).

**The Counter arm was run twice.** The first run exposed two bugs in Counter's own tools (below). We fixed them (commit `b0c8d25`) and re-ran only the Counter arm, all 40 tasks for both models, on the same stack. The storefront-arm runs were not repeated. The table shows the re-run; the first run's numbers follow it and are kept in `results/purchase.json` under `superseded`.

| Model | Arm | Tasks | Correct | Correct buys | Correct no-buys | Wrong buys | Missed buys | Median steps | Median seconds | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| openai-gpt-6-sol | Storefront + browser | 40 | 40 (100%) | 31 | 9 | **0** | 0 | 11.5 | 44.9 | $3.55 |
| openai-gpt-6-sol | Counter tools | 40 | 39 (98%) | 30 | 9 | **0** | 1 | 4 | 14.9 | $0.67 |
| z-ai-glm-5-3-flash | Storefront + browser | 40 | 39 (98%) | 30 | 9 | **0** | 1 | 10 | 26.8 | $0.32 |
| z-ai-glm-5-3-flash | Counter tools | 40 | 40 (100%) | 31 | 9 | **0** | 0 | 3 | 6.8 | $0.07 |

Failed runs: 2 of 160; 0 of the failed runs (0%) still bought something.

| Model | Arm | exact_variant | quantity | bundle | budget | constraint | should_not_buy | trap |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| openai-gpt-6-sol | Storefront + browser | 10/10 | 5/5 | 5/5 | 5/5 | 5/5 | 7/7 | 3/3 |
| openai-gpt-6-sol | Counter tools | 10/10 | 4/5 | 5/5 | 5/5 | 5/5 | 7/7 | 3/3 |
| z-ai-glm-5-3-flash | Storefront + browser | 10/10 | 4/5 | 5/5 | 5/5 | 5/5 | 7/7 | 3/3 |
| z-ai-glm-5-3-flash | Counter tools | 10/10 | 5/5 | 5/5 | 5/5 | 5/5 | 7/7 | 3/3 |

| Task | Model | Arm | Outcome | What happened |
| --- | --- | --- | --- | --- |
| T11 | openai-gpt-6-sol | Counter tools | MISSED_BUY | bought nothing; expected 4 x JC-PLATE-DINNER-INK-SINGLE |
| T14 | z-ai-glm-5-3-flash | Storefront + browser | MISSED_BUY | bought nothing; expected 2 x LL-HARBOR-FINGERING-L117-5 |

**First Counter-arm run, before the fix** (superseded, shown so nothing is hidden):

| Model | Arm | Tasks | Correct | Correct buys | Correct no-buys | Wrong buys | Missed buys | Median steps | Median seconds | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| openai-gpt-6-sol | Counter tools | 40 | 39 (98%) | 30 | 9 | **0** | 1 | 4 | 17.4 | $0.69 |
| z-ai-glm-5-3-flash | Counter tools | 40 | 39 (98%) | 30 | 9 | **0** | 1 | 3 | 8.7 | $0.06 |

Failed then: T02 (openai-gpt-6-sol, MISSED_BUY), T02 (z-ai-glm-5-3-flash, MISSED_BUY).

**Pre-registered targets for the Counter arm:** at least 38 of 40 correct and no wrong buys. Met in both runs (first run 39 and 39; re-run 39 and 40; no wrong buys in either).

## What we learned

**On this storefront, accuracy is a tie.** Every arm got 39 or 40 of 40 right with both models, and no run in either arm bought the wrong thing. We did not reproduce Visa's failure rate here, and we are not going to claim a gap the data does not show. The storefront the browser agent shopped is Counter's own: server-rendered, every option a labelled radio button, stock and "sold out" shown on each option, seconds sold as a separately named product, delivery dates on the page. The traps in the task set (seconds next to firsts, decaf next to regular, a grind picker that defaults to whole bean, dye lots) did not catch either model on pages built like that. Real merchant sites are messier; see Limits.

**The difference is effort.** For the same answers, the storefront arm took about three times the steps (median 10 to 11.5 against 3 to 4), three to four times the wall-clock time, and about five times the spend ($3.55 against $0.67 for the larger model; $0.32 against $0.07 for the small one). An average storefront run sent the model about 88,000 tokens; an average Counter run 15,000 to 21,000. The next section shows where those steps go.

**The one storefront failure.** T14, small model: ten skeins of Harbor fingering from one dye lot. The agent read the lot picker (L114: 3 skeins, L117: 4 skeins), concluded no lot had ten, and bought nothing. It never opened the pack-size picker, where L117 also comes as a 5-skein pack (two packs make ten). With Counter, `search_products` lists every variant including packs, and the same model bought two L117 packs.

**What the first Counter run found: T02, twice.** "The pour-over set in the cream color." The shop calls that glaze oat and describes it as "creamy off-white". Both models refused to buy on the Counter arm; both bought the oat set on the storefront. Two causes, both in Counter's tools:

- The buying rules in the tool descriptions said a colour must match exactly and a near match is a different product. Agents treated "cream" against "oat" as a mismatch, even after the larger model read "oat (creamy off-white)" in the description.
- `search_products` showed each variant's id but not its product's `parent_id`, so agents guessed `get_product` ids. In the first run the small model's `get_product` calls failed 27 times out of 30 (in 16 of its 40 runs), so in T02 it never saw the glaze description at all; the larger model lost 11 of 57 calls the same way.

The fix: search results now name each variant's product, `get_product` also opens a product from a variant id, and the rules say the shop's own words count (a colour, size or style word matches when the shop's attribute values or description say so) while still never swapping in another product, size, pack, roast, grind, decaf, seconds, made-to-order piece or dye lot. In the re-run every `get_product` call succeeded (66 of 66), and both models bought the oat set for T02, quoting the shop's description.

**What the re-run cost: T11, larger model.** The new rules also say "if two variants could both be what the user means, ask; if you can't ask, don't buy". For "four of the ink dinner plates", with the ink set of 4 and the pair sold out, the larger model decided singles versus a set was such a choice and bought nothing. In the first run it bought four singles, which is what the key expects. We report this as measured rather than rewording the rules against the test set; the rules should say that the same count of the same item in a different pack is not a different item.

**No wrong buys anywhere.** Every failure in both runs was the cautious kind: nothing bought. The failure Visa saw most, a purchase that should not have happened, did not occur.

## Where each arm spends its effort

Tasks that hinge on the total show the gap best, because on a website the only way to see shipping and tax is to build the cart and fill in the address. Step counts are tool calls, from the traces.

**T23: "As much Lakefront medium as you can get me for $60 total, shipping and tax included. Whole bean."** The answer is three 250 g bags ($57.90); the 1 kg bag lists at $52.00 but totals $62.19.

| Storefront + browser (larger model, 26 steps) | Counter tools (larger model, 5 steps) |
| --- | --- |
| 1-3: open the shop, wait for it to load, open Lakefront | 1: `search_products` "Lakefront medium whole bean" |
| 4-5: pick the 1 kg bag, add it to the cart | 2: `get_product` NP-LAKEFRONT, every roast, grind and bag with prices |
| 6-8: open the cart, fill in name and address, read the page: $62.19, over | 3: `create_cart` 1 × 1 kg: total $62.19, over |
| 9-12: back to the product, look at the 250 g bag, back to the cart, remove the 1 kg bag | 4: `update_cart` 3 × 250 g: total $57.90 |
| 13-16: open the 250 g bag again, set quantity 3, add to cart | 5: `checkout`: order placed |
| 17-19: open the cart, fill in the address again, read the page: $57.90 | |
| 20-24: open a second tab to check the 1 kg price, switch back, read the cart again | |
| 25-26: Checkout with PayPal, wait for the hand-off page | |

The small model took 30 steps on the storefront (it tried to remove the 1 kg bag from the product page with a stale element reference before doing it in the cart, and set the 250 g quantity with a script) against 5 with Counter.

**T24: "A small whole-bean bag each of the Kenya and the Guji, if both together come to under $50 shipped with tax. Otherwise just the Kenya."** Both bags total $52.54, so the answer is the Kenya alone ($32.16).

| Storefront + browser (small model, 17 steps) | Counter tools (small model, 5 steps) |
| --- | --- |
| 1-4: open the shop, wait, open the Kenya, wait | 1: `search_products` "Kenya whole bean" |
| 5: add the Kenya to the cart | 2: `search_products` "Guji whole bean" |
| 6-9: back to the shop, wait, open the Guji, add it | 3: `create_cart` Kenya + Guji: total $52.54, over |
| 10-11: open the cart, wait for it to load | 4: `update_cart` Kenya only: total $32.16 |
| 12-14: fill in name and address (twice), wait for tax: $52.54 | 5: `checkout`: order placed |
| 15: remove the Guji: $32.16 | |
| 16-17: Checkout with PayPal, wait for the hand-off page | |

The larger model took 19 steps on the storefront and 10 with Counter. Its Counter run built the same one-bag Kenya cart four times in a row before checking out, without saying why; it cost time, not money.

## Limits

- **One storefront, and a good one.** The storefront is Counter's reference storefront for these three demo shops, built in this repo with accessible markup. It is not a sample of real merchant sites, which have pop-ups, dropdowns, lazy-loaded variants and checkout flows with more steps. This benchmark measures the agent paths against one well-built site; it says nothing about how often browser agents fail on the open web.
- **Payment is stubbed.** The PayPal approval step, which a person does in both arms in production, is not measured.
- **One run per task and arm** (the Counter arm twice: before and after the tool fix). Temperature 0 does not make these models fully deterministic; a rerun can flip a task or two.
- **Two models**, both served through one provider.
- **Text-only browsing.** The browser agent reads accessibility snapshots, not screenshots, and keeps the two most recent snapshots in full. A vision-based browser agent could behave differently.
- **The store clock and stock are controlled**, which real shops are not: deliver-by tasks always see the same dates, and stock never changes during a run except through the agent's own order.

## Run it

```sh
# 1. A bench database, migrated (DATABASE_URL = the bench database, never production)
pnpm --filter @counter/db db:migrate

# 2. The server, on the bench database with the bench switches on
pnpm --filter web build
COUNTER_CLOCK=2026-11-10T15:00:00Z PAYMENTS_MODE=stub BENCH_KEY=<random> \
DATABASE_URL=<bench db> GATEWAY_PRIVATE_KEY_PEM=<gateway key> PUBLIC_BASE_URL=http://localhost:3105 \
  pnpm --filter web start -p 3105

# 3. The runs (reseeds the bench database itself; needs the same BENCH_KEY)
VENICE_API_KEY=... BENCH_KEY=<same> BENCH_DATABASE_URL=<bench db> \
  node bench/purchase/run.mjs --base-url http://localhost:3105 --models z-ai-glm-5-3-flash --tasks all

# 4. The tables below, from results/purchase.json
node bench/purchase/report.mjs --failures
```

`run.mjs` resumes: runs already in `results/purchase.json` are skipped (`--rerun T03,T07` repeats some, `--fresh` starts over). `--supersede "<why>"` repeats the selected arm and tasks and moves the earlier runs to `superseded` instead of overwriting them; the Counter re-run used `--arms counter --supersede ...`. Full traces go to `results/raw/purchase/` (not committed).
