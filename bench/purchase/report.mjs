#!/usr/bin/env node
// Prints the purchase benchmark tables as markdown from results/purchase.json.
//
//   node bench/purchase/report.mjs [--in results/purchase.json] [--failures]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './grade.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const i = argv.indexOf('--in');
const doc = JSON.parse(readFileSync(resolve(root, i >= 0 ? argv[i + 1] : 'results/purchase.json'), 'utf8'));
const runs = doc.runs;

const ARM = { storefront: 'Storefront + browser', counter: 'Counter tools' };
const pct = (n, d) => `${Math.round((100 * n) / d)}%`;
const num = (x) => (x == null ? '–' : Number.isInteger(x) ? String(x) : x.toFixed(1));

function summaryTable(rows) {
  console.log('| Model | Arm | Tasks | Correct | Correct buys | Correct no-buys | Wrong buys | Missed buys | Median steps | Median seconds | Cost |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of summarize(rows)) {
    console.log(
      `| ${s.model} | ${ARM[s.arm] ?? s.arm} | ${s.runs} | ${s.correct} (${pct(s.correct, s.runs)}) | ${s.correct_buys} | ${s.correct_no_buys} | ` +
        `**${s.wrong_buys}** | ${s.missed_buys} | ${num(s.median_steps)} | ${num(s.median_seconds)} | $${s.cost_usd.toFixed(2)} |`,
    );
  }
}

summaryTable(runs);

const failed = runs.filter((r) => r.verdict === 'WRONG_BUY' || r.verdict === 'MISSED_BUY');
const failedBought = failed.filter((r) => r.verdict === 'WRONG_BUY').length;
console.log('');
console.log(
  `Failed runs: ${failed.length} of ${runs.length}; ${failedBought} of the failed runs (${failed.length ? pct(failedBought, failed.length) : '0%'}) still bought something.`,
);

console.log('');
console.log('| Model | Arm | ' + [...new Set(runs.map((r) => r.category))].join(' | ') + ' |');
const cats = [...new Set(runs.map((r) => r.category))];
console.log('| --- | --- | ' + cats.map(() => '---:').join(' | ') + ' |');
for (const s of summarize(runs)) {
  const cells = cats.map((c) => {
    const g = runs.filter((r) => r.model === s.model && r.arm === s.arm && r.category === c);
    const ok = g.filter((r) => r.verdict === 'CORRECT' || r.verdict === 'CORRECT_NO_BUY').length;
    return g.length ? `${ok}/${g.length}` : '–';
  });
  console.log(`| ${s.model} | ${ARM[s.arm] ?? s.arm} | ${cells.join(' | ')} |`);
}

if (argv.includes('--failures')) {
  console.log('');
  console.log('| Task | Model | Arm | Outcome | What happened |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const r of failed) {
    const why = [...r.reasons, r.stopped_by !== 'answer' ? `stopped: ${r.stopped_by}` : null].filter(Boolean).join('; ');
    console.log(`| ${r.task} | ${r.model} | ${ARM[r.arm] ?? r.arm} | ${r.verdict} | ${why} |`);
  }
}

for (const old of doc.superseded ?? []) {
  console.log('');
  console.log(`Superseded (${old.superseded_at.slice(0, 10)}): ${old.label}`);
  console.log('');
  summaryTable(old.runs);
  const missed = old.runs.filter((r) => r.verdict === 'WRONG_BUY' || r.verdict === 'MISSED_BUY');
  if (missed.length) console.log(`\nFailed then: ${missed.map((r) => `${r.task} (${r.model}, ${r.verdict})`).join(', ')}`);
}
