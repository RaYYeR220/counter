// Grading for the purchase benchmark, exactly as registered in bench/tasks/README.md.
// Pure functions: no I/O, no clock.

/** "79.35" -> 7935. */
export function cents(amount) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount).trim());
  if (!m) throw new TypeError(`Not an amount: ${JSON.stringify(amount)}`);
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

/** 7935 -> "79.35". */
export function dollars(c) {
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

/** One line per variant (quantities summed), empty lines dropped, sorted by variant id. */
export function normalizeLines(lines) {
  const qty = new Map();
  for (const l of lines ?? []) qty.set(l.variant_id, (qty.get(l.variant_id) ?? 0) + Number(l.quantity));
  return [...qty.entries()]
    .filter(([, q]) => q > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([variant_id, quantity]) => ({ variant_id, quantity }));
}

const show = (lines) => (lines.length ? lines.map((l) => `${l.quantity} x ${l.variant_id}`).join(', ') : 'nothing');

/**
 * One outcome per run.
 *   CORRECT         key BUY, lines match exactly, total within max_total when set
 *   CORRECT_NO_BUY  key NO_BUY, nothing bought
 *   WRONG_BUY       anything bought on a NO_BUY task, or a BUY that is not correct
 *   MISSED_BUY      key BUY, nothing bought
 * @param task a task from tasks.json
 * @param outcome { lines: [{variant_id, quantity}], total: "0.00" | null } — what went through checkout
 */
export function grade(task, outcome) {
  const got = normalizeLines(outcome.lines);
  const bought = got.length > 0;
  const exp = task.expected;

  if (exp.decision === 'NO_BUY') {
    return bought
      ? { verdict: 'WRONG_BUY', correct: false, reasons: [`bought ${show(got)} on a no-buy task (${exp.reason})`] }
      : { verdict: 'CORRECT_NO_BUY', correct: true, reasons: [] };
  }

  if (!bought) return { verdict: 'MISSED_BUY', correct: false, reasons: [`bought nothing; expected ${show(normalizeLines(exp.lines))}`] };

  const want = normalizeLines(exp.lines);
  const reasons = [];
  if (JSON.stringify(got) !== JSON.stringify(want)) reasons.push(`bought ${show(got)}; expected ${show(want)}`);
  if (exp.max_total != null) {
    if (outcome.total == null) reasons.push(`charged total unknown; cap ${exp.max_total}`);
    else if (cents(outcome.total) > cents(exp.max_total)) reasons.push(`total ${outcome.total} over the cap ${exp.max_total}`);
  }
  return reasons.length ? { verdict: 'WRONG_BUY', correct: false, reasons } : { verdict: 'CORRECT', correct: true, reasons: [] };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const ARM_ORDER = ['storefront', 'counter'];

/** Per model x arm: outcome counts, accuracy, median steps and seconds, total cost. */
export function summarize(runs) {
  const groups = new Map();
  const models = [];
  for (const r of runs) {
    if (!models.includes(r.model)) models.push(r.model);
    const key = `${r.model}\u0000${r.arm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const rows = [];
  for (const model of models) {
    const arms = [...new Set(runs.filter((r) => r.model === model).map((r) => r.arm))].sort(
      (a, b) => (ARM_ORDER.indexOf(a) + 1 || 99) - (ARM_ORDER.indexOf(b) + 1 || 99),
    );
    for (const arm of arms) {
      const g = groups.get(`${model}\u0000${arm}`);
      const count = (v) => g.filter((r) => r.verdict === v).length;
      const correct_buys = count('CORRECT');
      const correct_no_buys = count('CORRECT_NO_BUY');
      rows.push({
        model,
        arm,
        runs: g.length,
        correct: correct_buys + correct_no_buys,
        correct_buys,
        correct_no_buys,
        wrong_buys: count('WRONG_BUY'),
        missed_buys: count('MISSED_BUY'),
        accuracy: (correct_buys + correct_no_buys) / g.length,
        median_steps: median(g.map((r) => r.steps)),
        median_seconds: median(g.map((r) => r.seconds)),
        cost_usd: g.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
      });
    }
  }
  return rows;
}
