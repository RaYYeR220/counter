#!/usr/bin/env node
// Purchase benchmark: does a shopping agent buy the right thing?
//
// The same model gets the same 40 registered tasks (bench/tasks/tasks.json) two ways:
//   storefront  the shop's normal web pages through a standard browser tool (Playwright MCP)
//   counter     Counter's agent tools for the same shop, over MCP
// Both arms run against one local Counter server on a bench database, with the store
// clock pinned and stock reset to the seed before each run. See README.md.
//
// Usage:
//   VENICE_API_KEY=... BENCH_KEY=... BENCH_DATABASE_URL=... \
//     node bench/purchase/run.mjs --base-url http://localhost:3105 --models z-ai-glm-5-3-flash \
//       [--tasks all|pilot|subset20|T01,T02] [--arms storefront,counter] [--concurrency 4] \
//       [--budget 5] [--out results/purchase.json] [--fresh] [--rerun T01,T02]
import '../negotiation/ts-resolve.mjs';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grade, normalizeLines, summarize } from './grade.mjs';
import { counterOutcome, storefrontOutcome } from './outcome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const { runAgent, connectCounter, connectPlaywright, PLAYWRIGHT_MCP_PACKAGE } = await import('../../packages/agent/src/index.ts');
const { veniceClient } = await import('../../packages/negotiate/src/index.ts');
// The seed and client modules directly: the package index pulls in repos that Node's type stripping can't load.
const { createDb } = await import('../../packages/db/src/client.ts');
const { seedCatalog, demoCatalog } = await import('../../packages/db/src/seed/seed.ts');

const registered = JSON.parse(readFileSync(resolve(root, 'bench/tasks/tasks.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Options

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const BASE = opt('base-url', 'http://localhost:3105').replace(/\/+$/, '');
const MODELS = opt('models', 'z-ai-glm-5-3-flash').split(',');
const ARMS = opt('arms', 'storefront,counter').split(',');
const CONCURRENCY = Number(opt('concurrency', '4'));
const BUDGET = Number(opt('budget', '15'));
const OUT = resolve(root, opt('out', 'results/purchase.json'));
const RAW = resolve(root, opt('raw', 'results/raw/purchase'));
const MAX_STEPS = Number(opt('max-steps', '40'));
const FRESH = flag('fresh');
const RERUN = new Set((opt('rerun', '') || '').split(',').filter(Boolean));
const TEMPERATURE = 0;
const RUN_TIMEOUT_MS = 20 * 60_000;
/** The shop directory caches stock for 15 s; after a purchase, wait it out before the next run reads stock. */
const DIRECTORY_TTL_MS = 16_000;

/** Fixed before any run: six tasks across all shops for the pilot, and a stratified half for a costly model. */
const SUBSETS = {
  pilot: ['T01', 'T04', 'T14', 'T21', 'T31', 'T38'],
  subset20: ['T01', 'T02', 'T04', 'T06', 'T08', 'T12', 'T14', 'T16', 'T18', 'T20', 'T21', 'T23', 'T25', 'T26', 'T29', 'T31', 'T34', 'T37', 'T38', 'T39'],
};
const taskArg = opt('tasks', 'all');
const TASK_IDS = taskArg === 'all' ? registered.tasks.map((t) => t.id) : SUBSETS[taskArg] ?? taskArg.split(',');
const TASKS = TASK_IDS.map((id) => {
  const t = registered.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown task ${id}`);
  return t;
});

/** USD per million tokens, used only when the provider does not report a cost. */
const PRICING = {
  'z-ai-glm-5-3-flash': { inputPerMTok: 0.15, outputPerMTok: 0.5 },
  'openai-gpt-6-sol': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10 },
};

/** What the model sees of tool outputs, the same in both arms. */
const CONTEXT = { maxToolChars: 24_000, keepRecentOutputs: 2, compactOverChars: 6_000 };

const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return v;
};
const apiKey = need('VENICE_API_KEY');
const benchKey = ARMS.includes('storefront') ? need('BENCH_KEY') : process.env.BENCH_KEY;
// A separate name on purpose: reseeding resets stock, so this must never pick up a production DATABASE_URL.
const benchDb = createDb(need('BENCH_DATABASE_URL'));
const llm = veniceClient({ apiKey, timeoutMs: 180_000, retries: 4 });

// ---------------------------------------------------------------------------
// Shops and prompts

const SHOPS = new Map(demoCatalog.shops.map((s) => [s.slug, s]));
const BUYER = { given_name: 'Sam', surname: 'Rivera' };

function systemPrompt(arm, task) {
  const shop = SHOPS.get(task.shop);
  const shared =
    `You are a shopping agent acting for a user. Buy exactly what they ask for from ${shop.name}, shipping to the address they give. ` +
    `If the exact item can't be bought, don't buy anything and explain why. ` +
    `The user can't answer questions during this task and has already approved the purchase: when the cart matches their request, complete the checkout yourself. Payment approval is handled for you. ` +
    `When you are done, reply with a short summary of what you bought, or why you bought nothing.`;
  return arm === 'storefront'
    ? `${shared} Use the browser tools. Start at ${BASE}/s/${task.shop}.`
    : `${shared} Use the shop tools. The shop's slug is ${task.shop}.`;
}

function userPrompt(task) {
  const a = task.shipping_address;
  return `${task.prompt}\n\nShip to: ${BUYER.given_name} ${BUYER.surname}, ${a.address_line_1}, ${a.admin_area_2}, ${a.admin_area_1} ${a.postal_code}, ${a.country_code}.`;
}

// ---------------------------------------------------------------------------
// Environment

async function reseed(slugs) {
  const shops = slugs.map((s) => SHOPS.get(s));
  await seedCatalog(benchDb, { catalog: { shops }, publicBaseUrl: BASE });
}

async function captures(runId) {
  const res = await fetch(`${BASE}/api/bench/capture?runId=${encodeURIComponent(runId)}`, { headers: { 'x-bench-key': benchKey } });
  if (!res.ok) throw new Error(`capture lookup failed: ${res.status} ${await res.text()}`);
  return (await res.json()).captures ?? [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (model) => model.replace(/[^A-Za-z0-9]+/g, '').slice(0, 16);

async function runOnce(model, arm, task) {
  const runId = `p-${short(model)}-${arm[0]}-${task.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const started = Date.now();
  let conn;
  let tmp;
  try {
    if (arm === 'storefront') {
      tmp = mkdtempSync(join(tmpdir(), 'counter-bench-'));
      const host = new URL(BASE).hostname;
      const state = join(tmp, 'state.json');
      writeFileSync(
        state,
        JSON.stringify({
          cookies: [{ name: 'counter_bench_run', value: runId, domain: host, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }],
          origins: [],
        }),
      );
      conn = await connectPlaywright({ storageState: state, outputDir: tmp });
    } else {
      conn = await connectCounter(`${BASE}/mcp`, { exclude: ['negotiate', 'list_shops'] });
    }

    const result = await runAgent({
      llm,
      model,
      system: systemPrompt(arm, task),
      task: userPrompt(task),
      mcp: [conn],
      maxSteps: MAX_STEPS,
      temperature: TEMPERATURE,
      timeoutMs: RUN_TIMEOUT_MS,
      pricing: PRICING[model],
      ...CONTEXT,
    });
    const seconds = (Date.now() - started) / 1000;
    const caps = arm === 'storefront' ? await captures(runId) : null;
    const outcome = arm === 'storefront' ? storefrontOutcome(caps) : counterOutcome(result.steps);
    return { runId, result, outcome, caps, seconds };
  } finally {
    await conn?.close().catch(() => undefined);
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Results file

function load() {
  if (FRESH || !existsSync(OUT)) return [];
  return JSON.parse(readFileSync(OUT, 'utf8')).runs ?? [];
}

const runs = load();
const keyOf = (r) => `${r.model}|${r.arm}|${r.task}`;
const done = new Set(runs.filter((r) => !RERUN.has(r.task)).map(keyOf));

function save() {
  const order = (r) => [r.model, r.arm === 'storefront' ? 0 : 1, r.task].join('|');
  runs.sort((a, b) => (order(a) < order(b) ? -1 : 1));
  const byCategory = [];
  for (const s of summarize(runs)) {
    const cats = new Map();
    for (const r of runs.filter((x) => x.model === s.model && x.arm === s.arm)) {
      const c = cats.get(r.category) ?? { model: s.model, arm: s.arm, category: r.category, runs: 0, correct: 0, wrong_buys: 0, missed_buys: 0 };
      c.runs++;
      if (r.verdict === 'CORRECT' || r.verdict === 'CORRECT_NO_BUY') c.correct++;
      if (r.verdict === 'WRONG_BUY') c.wrong_buys++;
      if (r.verdict === 'MISSED_BUY') c.missed_buys++;
      cats.set(r.category, c);
    }
    byCategory.push(...cats.values());
  }
  const doc = {
    benchmark: 'purchase',
    tasks_version: registered.version,
    tasks_registered_at: registered.registered_at,
    environment: {
      store_clock: '2026-11-10T15:00:00Z',
      stock: 'reset to the seed before every run',
      prices: 'list prices; no negotiation tool in either arm',
      payments: 'stubbed (PAYMENTS_MODE=stub); the storefront records its checkout instead of opening PayPal',
      max_steps: MAX_STEPS,
      temperature: TEMPERATURE,
      browser: `${PLAYWRIGHT_MCP_PACKAGE} --headless --isolated --no-webmcp`,
      context: CONTEXT,
    },
    summary: summarize(runs),
    by_category: byCategory,
    runs,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(`${OUT}.tmp`, JSON.stringify(doc, null, 2) + '\n');
  renameSync(`${OUT}.tmp`, OUT);
}

let spent = 0;
const overBudget = () => spent >= BUDGET;

async function runAndRecord(model, arm, task) {
  let attempt = 0;
  let r;
  for (;;) {
    attempt++;
    r = await runOnce(model, arm, task);
    if (r.result.stoppedBy !== 'error' || attempt >= 3) break;
    console.log(`  ${task.id} ${arm} ${model}: model error (${r.result.error?.slice(0, 120)}), retrying`);
    spent += r.result.costUsd;
    await sleep(20_000);
  }
  const { result, outcome } = r;
  const g = grade(task, outcome);
  spent += result.costUsd;
  const row = {
    task: task.id,
    category: task.category,
    shop: task.shop,
    arm,
    model,
    run_id: r.runId,
    expected_decision: task.expected.decision,
    expected_lines: task.expected.decision === 'BUY' ? normalizeLines(task.expected.lines) : [],
    decision: outcome.lines.length ? 'BUY' : 'NO_BUY',
    lines: outcome.lines,
    total: outcome.total,
    checkouts: outcome.checkouts,
    verdict: g.verdict,
    reasons: g.reasons,
    steps: result.steps.length,
    tokens: { prompt: result.usage.promptTokens, completion: result.usage.completionTokens },
    model_calls: result.usage.calls,
    cost_usd: Math.round(result.costUsd * 1e6) / 1e6,
    seconds: Math.round(r.seconds * 10) / 10,
    stopped_by: result.stoppedBy,
    ...(result.error ? { error: result.error.slice(0, 500) } : {}),
    ...(arm === 'counter' ? { last_cart: outcome.last_cart } : {}),
    ...(attempt > 1 ? { attempts: attempt } : {}),
    final_text: result.finalText.slice(0, 800),
  };
  const i = runs.findIndex((x) => keyOf(x) === keyOf(row));
  if (i >= 0) runs.splice(i, 1, row);
  else runs.push(row);
  save();

  const rawDir = join(RAW, short(model), arm);
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(
    join(rawDir, `${task.id}.json`),
    JSON.stringify({ row, system: systemPrompt(arm, task), prompt: userPrompt(task), outcome, captures: r.caps, steps: result.steps, messages: result.messages }, null, 2),
  );
  console.log(
    `${task.id} ${arm.padEnd(10)} ${model}: ${g.verdict.padEnd(14)} ${row.steps} steps ${row.seconds}s $${row.cost_usd.toFixed(4)}` +
      (g.reasons.length ? ` | ${g.reasons.join('; ')}` : '') +
      (result.stoppedBy !== 'answer' ? ` [${result.stoppedBy}]` : ''),
  );
  return outcome.checkouts > 0;
}

/** Runs that buy change stock, so each shop gets one lane: reseed, run, next. */
async function counterPhase(model, tasks) {
  const lanes = new Map();
  for (const t of tasks) lanes.set(t.shop, [...(lanes.get(t.shop) ?? []), t]);
  await Promise.all(
    [...lanes.entries()].map(async ([shop, list]) => {
      let boughtAt = 0;
      for (const task of list) {
        if (overBudget()) return;
        await reseed([shop]);
        const wait = boughtAt + DIRECTORY_TTL_MS - Date.now();
        if (wait > 0) await sleep(wait);
        if (await runAndRecord(model, 'counter', task)) boughtAt = Date.now();
      }
    }),
  );
}

/** Storefront checkouts are recorded, not booked, so stock never moves and runs can share the store. */
async function storefrontPhase(model, tasks) {
  if (!tasks.length) return;
  await reseed([...new Set(tasks.map((t) => t.shop))]);
  await sleep(DIRECTORY_TTL_MS);
  const queue = [...tasks];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let task = queue.shift(); task; task = queue.shift()) {
        if (overBudget()) return;
        await runAndRecord(model, 'storefront', task);
      }
    }),
  );
}

console.log(`Purchase benchmark: ${TASKS.length} tasks x ${ARMS.join('+')} x ${MODELS.join(', ')} against ${BASE}; budget $${BUDGET}`);
for (const model of MODELS) {
  const todo = (arm) => TASKS.filter((t) => !done.has(`${model}|${arm}|${t.id}`));
  if (ARMS.includes('counter')) await counterPhase(model, todo('counter'));
  if (ARMS.includes('storefront')) await storefrontPhase(model, todo('storefront'));
}
if (overBudget()) console.log(`Stopped at the budget: $${spent.toFixed(4)} spent`);
console.log(`Spent $${spent.toFixed(4)} this run.`);
for (const s of summarize(runs)) {
  console.log(
    `${s.model} ${s.arm}: ${s.correct}/${s.runs} correct, ${s.wrong_buys} wrong buys, ${s.missed_buys} missed, median ${s.median_steps} steps, $${s.cost_usd.toFixed(4)}`,
  );
}
process.exit(0);
