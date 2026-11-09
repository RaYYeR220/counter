import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { grade, normalizeLines, summarize } from '../grade.mjs';

const buy = (lines, max_total = null) => ({ id: 'T', expected: { decision: 'BUY', lines, max_total } });
const noBuy = { id: 'N', expected: { decision: 'NO_BUY', reason: 'out_of_stock' } };
const line = (variant_id, quantity) => ({ variant_id, quantity });

describe('normalizeLines', () => {
  it('merges repeated variants, drops empty lines and sorts', () => {
    assert.deepEqual(normalizeLines([line('B', 1), line('A', 1), line('B', 2), line('C', 0)]), [line('A', 1), line('B', 3)]);
  });
});

describe('grade', () => {
  it('is a correct buy when the lines match the key exactly', () => {
    const g = grade(buy([line('MUG-SAGE', 2)]), { lines: [line('MUG-SAGE', 2)], total: '79.35' });
    assert.equal(g.verdict, 'CORRECT');
    assert.equal(g.correct, true);
  });

  it('ignores line order and split lines of the same variant', () => {
    const key = buy([line('A', 1), line('B', 2)]);
    assert.equal(grade(key, { lines: [line('B', 1), line('A', 1), line('B', 1)], total: null }).verdict, 'CORRECT');
  });

  it('is a wrong buy when a variant differs', () => {
    const g = grade(buy([line('MUG-SAGE', 2)]), { lines: [line('MUG-SECONDS-SAGE', 2)], total: '60.00' });
    assert.equal(g.verdict, 'WRONG_BUY');
    assert.equal(g.correct, false);
    assert.match(g.reasons.join(' '), /MUG-SECONDS-SAGE/);
  });

  it('is a wrong buy when a quantity differs', () => {
    assert.equal(grade(buy([line('A', 2)]), { lines: [line('A', 4)], total: null }).verdict, 'WRONG_BUY');
  });

  it('is a wrong buy when there is an extra line', () => {
    assert.equal(grade(buy([line('A', 1)]), { lines: [line('A', 1), line('B', 1)], total: null }).verdict, 'WRONG_BUY');
  });

  it('is a missed buy when nothing was bought', () => {
    const g = grade(buy([line('A', 1)]), { lines: [], total: null });
    assert.equal(g.verdict, 'MISSED_BUY');
    assert.equal(g.correct, false);
  });

  it('is a correct no-buy when nothing was bought on a no-buy task', () => {
    const g = grade(noBuy, { lines: [], total: null });
    assert.equal(g.verdict, 'CORRECT_NO_BUY');
    assert.equal(g.correct, true);
  });

  it('is a wrong buy when anything was bought on a no-buy task', () => {
    assert.equal(grade(noBuy, { lines: [line('A', 1)], total: '10.00' }).verdict, 'WRONG_BUY');
  });

  it('treats a cart of empty lines as no purchase', () => {
    assert.equal(grade(noBuy, { lines: [line('A', 0)], total: '0.00' }).verdict, 'CORRECT_NO_BUY');
  });

  describe('with a budget', () => {
    const key = buy([line('OAT-12', 2)], '80.00');
    it('accepts a total at or under the cap', () => {
      assert.equal(grade(key, { lines: [line('OAT-12', 2)], total: '79.35' }).verdict, 'CORRECT');
      assert.equal(grade(key, { lines: [line('OAT-12', 2)], total: '80.00' }).verdict, 'CORRECT');
    });
    it('is a wrong buy over the cap', () => {
      const g = grade(key, { lines: [line('OAT-12', 2)], total: '88.34' });
      assert.equal(g.verdict, 'WRONG_BUY');
      assert.match(g.reasons.join(' '), /88\.34.*80\.00/);
    });
    it('is a wrong buy when the charged total is unknown', () => {
      assert.equal(grade(key, { lines: [line('OAT-12', 2)], total: null }).verdict, 'WRONG_BUY');
    });
  });
});

describe('summarize', () => {
  const run = (model, arm, verdict, steps, seconds, cost) => ({ model, arm, verdict, steps, seconds, cost_usd: cost });

  it('counts outcomes and medians per model and arm', () => {
    const rows = summarize([
      run('m1', 'counter', 'CORRECT', 4, 10, 0.01),
      run('m1', 'counter', 'CORRECT_NO_BUY', 6, 20, 0.02),
      run('m1', 'counter', 'WRONG_BUY', 8, 30, 0.03),
      run('m1', 'storefront', 'MISSED_BUY', 20, 100, 0.1),
      run('m1', 'storefront', 'WRONG_BUY', 30, 200, 0.2),
    ]);
    assert.equal(rows.length, 2);
    const c = rows.find((r) => r.arm === 'counter');
    assert.deepEqual(
      { ...c, cost_usd: Math.round(c.cost_usd * 100) / 100 },
      {
        model: 'm1',
        arm: 'counter',
        runs: 3,
        correct: 2,
        correct_buys: 1,
        correct_no_buys: 1,
        wrong_buys: 1,
        missed_buys: 0,
        accuracy: 2 / 3,
        median_steps: 6,
        median_seconds: 20,
        cost_usd: 0.06,
      },
    );
    const s = rows.find((r) => r.arm === 'storefront');
    assert.equal(s.median_steps, 25);
    assert.equal(s.wrong_buys, 1);
    assert.equal(s.missed_buys, 1);
    assert.equal(s.correct, 0);
  });

  it('lists models in first-seen order with the storefront arm first', () => {
    const rows = summarize([run('b', 'counter', 'CORRECT', 1, 1, 0), run('a', 'storefront', 'CORRECT', 1, 1, 0), run('b', 'storefront', 'CORRECT', 1, 1, 0)]);
    assert.deepEqual(rows.map((r) => `${r.model}/${r.arm}`), ['b/storefront', 'b/counter', 'a/storefront']);
  });
});
