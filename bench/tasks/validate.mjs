#!/usr/bin/env node
// Checks the registered task set against the demo catalog.
// Usage: node bench/tasks/validate.mjs   (no dependencies, exits 1 on any error)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(resolve(here, '../../packages/db/src/seed/catalog.json'), 'utf8'));
const registered = JSON.parse(readFileSync(resolve(here, 'tasks.json'), 'utf8'));

// Store rules every task is computed under (see README.md).
const ORDER_DATE = '2026-11-10';
const SHIPPING = {
  STANDARD: { cents: 599, freeAboveCents: 7500, transitDays: 5 },
  EXPRESS: { cents: 1499, freeAboveCents: null, transitDays: 2 },
};
const TAX_BASIS_POINTS = 725;
const TAX_FREE_STATES = new Set(['OR', 'MT', 'NH', 'DE']);

const CATEGORIES = ['exact_variant', 'quantity', 'bundle', 'budget', 'constraint', 'should_not_buy', 'trap'];
const NO_BUY_REASONS = ['out_of_stock', 'not_offered', 'over_budget', 'not_purchasable', 'lead_time'];
const FLAGS = ['seconds', 'made_to_order', 'decaf', 'subscription_only', 'limited'];
const KEYS = {
  shop: ['slug', 'name', 'tagline', 'owner', 'city', 'state', 'about', 'policy', 'products'],
  policy: ['returns_days', 'ships_from_state', 'handling_days', 'negotiation'],
  negotiation: ['enabled', 'max_discount_pct', 'bundle_min_items'],
  product: ['parent_id', 'name', 'category', 'description', 'images', 'attributes_order', 'variants'],
  variant: ['variant_id', 'attributes', 'price', 'cost', 'floor', 'stock', 'weight_g', 'active', 'purchasable', 'lead_time_days', 'flags'],
  task: ['id', 'shop', 'category', 'prompt', 'shipping_address', 'expected', 'notes'],
  address: ['address_line_1', 'admin_area_2', 'admin_area_1', 'postal_code', 'country_code'],
  buy: ['decision', 'lines', 'max_total'],
  noBuy: ['decision', 'reason'],
};

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const sameKeys = (obj, keys) => obj && typeof obj === 'object' && Object.keys(obj).join() === keys.join();
const checkKeys = (where, obj, keys) => { if (!sameKeys(obj, keys)) fail(where, `keys must be exactly [${keys.join(', ')}]`); };

// ---- money ----
const MONEY = /^\d+\.\d{2}$/;
const toCents = (s) => { const [d, c] = s.split('.'); return Number(d) * 100 + Number(c); };
const fmt = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
const taxCents = (state, taxable) => (TAX_FREE_STATES.has(state) ? 0 : Math.floor((taxable * TAX_BASIS_POINTS + 5000) / 10000));

// ---- dates (UTC calendar dates, business days are Mon-Fri) ----
const parseDate = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
function addBusinessDays(d, n) {
  let out = d;
  while (n > 0) { out = addDays(out, 1); const w = out.getUTCDay(); if (w !== 0 && w !== 6) n--; }
  return out;
}
const readyDate = (shop, v) => addBusinessDays(addDays(parseDate(ORDER_DATE), v.lead_time_days), shop.policy.handling_days);
function arrival(shop, variants, option) {
  const ready = variants.map((v) => readyDate(shop, v)).reduce((a, b) => (a > b ? a : b));
  return addBusinessDays(ready, SHIPPING[option].transitDays);
}

// ---- catalog ----
const shops = new Map();
const variantsById = new Map();
if (catalog.version !== 1 || catalog.currency !== 'USD' || !Array.isArray(catalog.shops)) fail('catalog', 'needs version 1, currency USD, shops[]');
for (const shop of catalog.shops) {
  const w = `catalog/${shop.slug}`;
  checkKeys(w, shop, KEYS.shop);
  checkKeys(`${w}.policy`, shop.policy, KEYS.policy);
  checkKeys(`${w}.policy.negotiation`, shop.policy?.negotiation, KEYS.negotiation);
  const vs = [];
  for (const p of shop.products) {
    const pw = `${w}/${p.parent_id}`;
    checkKeys(pw, p, KEYS.product);
    const combos = new Set();
    for (const v of p.variants) {
      const vw = `${pw}/${v.variant_id}`;
      checkKeys(vw, v, KEYS.variant);
      if (!/^[A-Z0-9]+(-[A-Z0-9]+)+$/.test(v.variant_id)) fail(vw, 'variant_id must be uppercase and hyphenated');
      if (!v.variant_id.startsWith(`${p.parent_id}-`)) fail(vw, 'variant_id must start with parent_id');
      if (variantsById.has(v.variant_id)) fail(vw, 'duplicate variant_id');
      if (!sameKeys(v.attributes, p.attributes_order)) fail(vw, 'attributes must follow attributes_order');
      const combo = JSON.stringify(v.attributes);
      if (combos.has(combo)) fail(vw, 'duplicate attribute combination');
      combos.add(combo);
      for (const k of ['price', 'cost', 'floor']) if (!MONEY.test(v[k])) fail(vw, `${k} must be a "0.00" string`);
      const [price, cost, floor] = [toCents(v.price), toCents(v.cost), toCents(v.floor)];
      if (!(cost < price)) fail(vw, 'cost must be below price');
      if (floor * 100 < cost * 125) fail(vw, 'floor must be at least cost x 1.25');
      if (floor > price) fail(vw, 'floor must not exceed price');
      if (!Number.isInteger(v.stock) || v.stock < 0 || v.stock > 40) fail(vw, 'stock must be an integer 0-40');
      if (!v.flags.every((f) => FLAGS.includes(f))) fail(vw, `unknown flag in [${v.flags}]`);
      if (v.flags.includes('made_to_order') !== v.lead_time_days > 0) fail(vw, 'made_to_order and lead_time_days > 0 go together');
      if (v.flags.includes('subscription_only') && v.purchasable) fail(vw, 'subscription_only variants are not purchasable');
      variantsById.set(v.variant_id, { ...v, shop: shop.slug, parent: p });
      vs.push(v);
    }
  }
  shop.allVariants = vs;
  if (vs.length < 28) fail(w, `needs at least 28 variants, has ${vs.length}`);
  const oos = vs.filter((v) => v.purchasable && v.stock === 0).length;
  if (oos < 3) fail(w, `needs at least 3 out-of-stock variants, has ${oos}`);
  shops.set(shop.slug, shop);
}

// ---- cart math ----
function quote(shop, lines, state, option = 'STANDARD') {
  const subtotal = lines.reduce((s, l) => s + toCents(variantsById.get(l.variant_id).price) * l.quantity, 0);
  const rule = SHIPPING[option];
  const shipping = rule.freeAboveCents !== null && subtotal > rule.freeAboveCents ? 0 : rule.cents;
  const tax = taxCents(state, subtotal + shipping);
  return { subtotal, shipping, tax, total: subtotal + shipping + tax };
}

// ---- tasks ----
const ID = /\b(?:JC|NP|LL)-[A-Z0-9-]*[A-Z0-9]\b/g;
const STOCK_CLAIM = /\b((?:JC|NP|LL)-[A-Z0-9-]*[A-Z0-9]) stock (\d+)(?: < (\d+))?/g;
const rows = [];
if (registered.version !== 1 || registered.registered_at !== '2026-11-09') fail('tasks', 'needs version 1 and registered_at 2026-11-09');
checkKeys('tasks.targets', registered.targets, ['counter_correct_min', 'counter_wrong_buys_max']);
if (registered.tasks.length !== 40) fail('tasks', `expected 40 tasks, found ${registered.tasks.length}`);

registered.tasks.forEach((task, i) => {
  const w = task.id ?? `#${i + 1}`;
  checkKeys(w, task, KEYS.task);
  if (task.id !== `T${String(i + 1).padStart(2, '0')}`) fail(w, 'ids must run T01..T40 in order');
  if (!CATEGORIES.includes(task.category)) fail(w, `unknown category ${task.category}`);
  const shop = shops.get(task.shop);
  if (!shop) { fail(w, `unknown shop ${task.shop}`); return; }
  const a = task.shipping_address;
  checkKeys(`${w}.shipping_address`, a, KEYS.address);
  if (a.country_code !== 'US' || !/^[A-Z]{2}$/.test(a.admin_area_1) || !/^\d{5}$/.test(a.postal_code)) fail(w, 'address must be a US address with a 2-letter state and 5-digit ZIP');
  const notes = task.notes ?? '';
  const e = task.expected;

  // Every variant named in the notes must exist in this shop; every stock figure quoted must be true.
  const mentioned = [...new Set(notes.match(ID) ?? [])];
  for (const id of mentioned) if (variantsById.get(id)?.shop !== task.shop) fail(w, `notes mention ${id}, not a ${task.shop} variant`);
  const claims = [...notes.matchAll(STOCK_CLAIM)].map(([, id, n, need]) => ({ id, n: Number(n), need: need === undefined ? null : Number(need) }));
  for (const c of claims) {
    const v = variantsById.get(c.id);
    if (v && v.stock !== c.n) fail(w, `notes say ${c.id} stock ${c.n}, catalog has ${v.stock}`);
    if (c.need !== null && !(c.n < c.need)) fail(w, `notes claim ${c.id} stock ${c.n} < ${c.need}`);
  }
  const deliverBy = notes.match(/deliver-by (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const fastest = (variants) => iso(arrival(shop, variants, 'EXPRESS'));

  let key = '';
  let total = '';
  if (e?.decision === 'BUY') {
    checkKeys(`${w}.expected`, e, KEYS.buy);
    if (!Array.isArray(e.lines) || e.lines.length === 0) { fail(w, 'BUY needs at least one line'); return; }
    if (new Set(e.lines.map((l) => l.variant_id)).size !== e.lines.length) fail(w, 'duplicate variant in lines');
    if (task.category === 'bundle' && e.lines.length < 2) fail(w, 'bundle tasks need 2+ lines');
    let linesOk = true;
    for (const l of e.lines) {
      const v = variantsById.get(l.variant_id);
      if (!sameKeys(l, ['variant_id', 'quantity']) || !Number.isInteger(l.quantity) || l.quantity < 1) fail(w, `bad line ${JSON.stringify(l)}`);
      if (!v) { fail(w, `${l.variant_id} does not exist`); linesOk = false; continue; }
      if (v.shop !== task.shop) { fail(w, `${l.variant_id} belongs to ${v.shop}`); linesOk = false; }
      if (!v.active || !v.purchasable) fail(w, `${l.variant_id} cannot be bought`);
      if (v.stock < l.quantity) fail(w, `${l.variant_id} stock ${v.stock} < quantity ${l.quantity}`);
    }
    if (!linesOk) return;
    const q = quote(shop, e.lines, a.admin_area_1);
    total = fmt(q.total);
    key = 'BUY ' + e.lines.map((l) => `${l.variant_id} x${l.quantity}`).join(' + ');
    if (e.max_total !== null) {
      if (!MONEY.test(String(e.max_total))) fail(w, 'max_total must be null or a "0.00" string');
      else if (q.total > toCents(e.max_total)) fail(w, `total ${total} exceeds max_total ${e.max_total}`);
      if (!notes.includes(`$${total}`)) fail(w, `notes must state the computed total $${total}`);
    }
    if (task.category === 'budget' && e.max_total === null) fail(w, 'budget BUY tasks need max_total');
    if (deliverBy) {
      const lineVariants = e.lines.map((l) => variantsById.get(l.variant_id));
      if (fastest(lineVariants) > deliverBy) fail(w, `lines cannot arrive by ${deliverBy}`);
      const stated = notes.match(/arrives (\d{4}-\d{2}-\d{2})/)?.[1];
      const standard = iso(arrival(shop, lineVariants, 'STANDARD'));
      if (stated && stated !== standard) fail(w, `notes say arrives ${stated}, standard arrival is ${standard}`);
      for (const id of mentioned) if (!e.lines.some((l) => l.variant_id === id) && fastest([variantsById.get(id)]) <= deliverBy) fail(w, `${id} could arrive by ${deliverBy}, so the key is not unique`);
    }
  } else if (e?.decision === 'NO_BUY') {
    checkKeys(`${w}.expected`, e, KEYS.noBuy);
    if (!NO_BUY_REASONS.includes(e.reason)) fail(w, `unknown reason ${e.reason}`);
    key = `NO_BUY ${e.reason}`;
    if (e.reason === 'out_of_stock') {
      if (!claims.some((c) => c.n === 0 || (c.need !== null && c.n < c.need))) fail(w, 'out_of_stock needs a "<ID> stock 0" or "<ID> stock N < M" note');
    } else if (e.reason === 'not_offered') {
      const specs = [...notes.matchAll(/`([^`]+)`/g)].map(([, s]) => s.split(/,\s*/).map((kv) => kv.split('=')));
      if (specs.length === 0) fail(w, 'not_offered needs a `attribute=value` spec in notes');
      for (const spec of specs) {
        const hit = shop.allVariants.find((v) => spec.every(([k, val]) => v.attributes[k] === val));
        if (hit) fail(w, `\`${spec.map((kv) => kv.join('=')).join(', ')}\` is offered as ${hit.variant_id}`);
      }
    } else if (e.reason === 'not_purchasable') {
      if (mentioned.length === 0) fail(w, 'not_purchasable needs the variant ids in notes');
      for (const id of mentioned) if (variantsById.get(id)?.purchasable !== false) fail(w, `${id} is purchasable`);
    } else if (e.reason === 'lead_time') {
      if (!deliverBy || mentioned.length === 0) fail(w, 'lead_time needs "deliver-by YYYY-MM-DD" and the variant ids in notes');
      for (const id of mentioned) if (fastest([variantsById.get(id)]) <= deliverBy) fail(w, `${id} can arrive by ${deliverBy}`);
    } else if (e.reason === 'over_budget') {
      const lines = [...notes.matchAll(/\b((?:JC|NP|LL)-[A-Z0-9-]*[A-Z0-9]) x(\d+)/g)].map(([, variant_id, n]) => ({ variant_id, quantity: Number(n) }));
      const cap = notes.match(/\$(\d+\.\d{2}) cap/)?.[1];
      if (lines.length === 0 || !cap) fail(w, 'over_budget needs "<ID> xN" lines and a "$0.00 cap" in notes');
      else {
        const q = quote(shop, lines, a.admin_area_1);
        total = fmt(q.total);
        if (q.total <= toCents(cap)) fail(w, `would-be total ${total} fits the $${cap} cap`);
        if (!notes.includes(`$${total}`)) fail(w, `notes must state the computed total $${total}`);
      }
    }
  } else {
    fail(w, 'expected.decision must be BUY or NO_BUY');
  }
  if (task.category === 'should_not_buy' && e?.decision !== 'NO_BUY') fail(w, 'should_not_buy tasks must be NO_BUY');
  rows.push({ id: task.id, shop: task.shop, category: task.category, state: a.admin_area_1, key, total });
});

const orAddresses = registered.tasks.filter((t) => t.shipping_address?.admin_area_1 === 'OR').length;
if (orAddresses < 2) fail('tasks', `needs at least 2 Oregon addresses, has ${orAddresses}`);
const t = registered.targets;
if (!(Number.isInteger(t.counter_correct_min) && t.counter_correct_min <= registered.tasks.length && t.counter_wrong_buys_max >= 0)) fail('tasks.targets', 'targets out of range');

// ---- report ----
function table(headers, data) {
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  return [line(headers), line(widths.map((n) => '-'.repeat(n))), ...data.map(line)].join('\n');
}

console.log('Catalog');
console.log(table(['shop', 'products', 'variants', 'out of stock', 'flagged variants'], catalog.shops.map((s) => {
  const flagged = {};
  for (const v of s.allVariants) for (const f of v.flags) flagged[f] = (flagged[f] ?? 0) + 1;
  return [s.slug, s.products.length, s.allVariants.length, s.allVariants.filter((v) => v.purchasable && v.stock === 0).length,
    Object.entries(flagged).map(([f, n]) => `${f} ${n}`).join(', ') || '-'];
})));

console.log('\nTasks (total = standard shipping + tax to the task address)');
console.log(table(['id', 'shop', 'category', 'st', 'answer key', 'total'], rows.map((r) => [r.id, r.shop, r.category, r.state, r.key, r.total || '-'])));

console.log('\nDistribution');
const slugs = catalog.shops.map((s) => s.slug);
console.log(table(['category', ...slugs, 'all'], [...CATEGORIES, 'all'].map((c) => {
  const pick = (s) => rows.filter((r) => (c === 'all' || r.category === c) && (!s || r.shop === s)).length;
  return [c, ...slugs.map(pick), pick()];
})));
const buys = rows.filter((r) => r.key.startsWith('BUY')).length;
console.log(`\nBUY ${buys}  NO_BUY ${rows.length - buys}  Oregon addresses ${orAddresses}  targets: correct >= ${t.counter_correct_min}/${registered.tasks.length}, wrong buys <= ${t.counter_wrong_buys_max}`);

if (errors.length) {
  console.error(`\nFAIL: ${errors.length} problem(s)`);
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}
console.log(`\nOK: ${registered.tasks.length} tasks check out against ${variantsById.size} variants.`);
