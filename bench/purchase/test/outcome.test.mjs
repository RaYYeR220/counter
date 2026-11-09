import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { counterOutcome, storefrontOutcome } from '../outcome.mjs';

const cart = (cart_id, items, total, status = 'CREATED') => ({
  cart_id,
  status,
  items: items.map(([variant_id, quantity]) => ({ variant_id, quantity, name: variant_id })),
  shipping_address: { admin_area_1: 'CA' },
  totals: { total },
});
const step = (tool, structured, isError = false) => ({ tool, args: {}, resultText: '', isError, structured, ms: 1 });
const checkout = (c, completed = true) =>
  step('checkout', { completed, needs_approval: false, order_number: completed ? `JC-${c.cart_id}` : undefined, cart: { ...c, status: completed ? 'COMPLETED' : c.status } });

describe('counterOutcome', () => {
  it('is the cart that went through checkout', () => {
    const c1 = cart('c1', [['MUG', 1]], '40.00');
    const c1b = cart('c1', [['MUG', 2]], '74.00');
    const out = counterOutcome([step('search_products', {}), step('create_cart', c1), step('update_cart', c1b), checkout(c1b)]);
    assert.deepEqual(out.lines, [{ variant_id: 'MUG', quantity: 2 }]);
    assert.equal(out.total, '74.00');
    assert.equal(out.checkouts, 1);
    assert.deepEqual(out.orders, ['JC-c1']);
    assert.deepEqual(out.last_cart.lines, [{ variant_id: 'MUG', quantity: 2 }]);
  });

  it('counts a repeated checkout of the same cart once', () => {
    const c1 = cart('c1', [['MUG', 1]], '40.00');
    const out = counterOutcome([step('create_cart', c1), checkout(c1), checkout(c1)]);
    assert.deepEqual(out.lines, [{ variant_id: 'MUG', quantity: 1 }]);
    assert.equal(out.total, '40.00');
    assert.equal(out.checkouts, 1);
  });

  it('adds up two separate orders', () => {
    const a = cart('a', [['MUG', 1]], '40.00');
    const b = cart('b', [['BOWL', 1], ['MUG', 1]], '60.50');
    const out = counterOutcome([checkout(a), checkout(b)]);
    assert.deepEqual(out.lines, [
      { variant_id: 'BOWL', quantity: 1 },
      { variant_id: 'MUG', quantity: 2 },
    ]);
    assert.equal(out.total, '100.50');
    assert.equal(out.checkouts, 2);
  });

  it('is no purchase when checkout did not complete, but keeps the last cart', () => {
    const c1 = cart('c1', [['MUG', 1]], '40.00');
    const out = counterOutcome([step('create_cart', c1), checkout(c1, false), step('checkout', { message: 'x' }, true)]);
    assert.deepEqual(out.lines, []);
    assert.equal(out.total, null);
    assert.equal(out.checkouts, 0);
    assert.deepEqual(out.last_cart, { cart_id: 'c1', lines: [{ variant_id: 'MUG', quantity: 1 }], total: '40.00', status: 'CREATED' });
  });

  it('is no purchase when the agent never built a cart', () => {
    const out = counterOutcome([step('search_products', {})]);
    assert.deepEqual(out, { lines: [], total: null, checkouts: 0, orders: [], last_cart: null, address: null });
  });
});

describe('storefrontOutcome', () => {
  const cap = (lines, total, state = 'CA') => ({
    runId: 'r1',
    shop: 'juniper-clay',
    lines: lines.map(([variant_id, quantity]) => ({ variant_id, quantity })),
    shipping_address: { admin_area_1: state },
    shipping_option: 'STANDARD',
    total,
  });

  it('is empty when nothing was checked out', () => {
    assert.deepEqual(storefrontOutcome([]), { lines: [], total: null, checkouts: 0, address: null });
  });

  it('is the captured checkout', () => {
    const out = storefrontOutcome([cap([['MUG', 2]], '74.00')]);
    assert.deepEqual(out.lines, [{ variant_id: 'MUG', quantity: 2 }]);
    assert.equal(out.total, '74.00');
    assert.equal(out.checkouts, 1);
    assert.deepEqual(out.address, { admin_area_1: 'CA' });
  });

  it('collapses a checkout clicked twice into one', () => {
    const out = storefrontOutcome([cap([['MUG', 2]], '74.00'), cap([['MUG', 2]], '74.00')]);
    assert.deepEqual(out.lines, [{ variant_id: 'MUG', quantity: 2 }]);
    assert.equal(out.total, '74.00');
    assert.equal(out.checkouts, 1);
  });

  it('adds up different checkouts', () => {
    const out = storefrontOutcome([cap([['MUG', 2]], '74.00'), cap([['MUG', 1]], '40.00')]);
    assert.deepEqual(out.lines, [{ variant_id: 'MUG', quantity: 3 }]);
    assert.equal(out.total, '114.00');
    assert.equal(out.checkouts, 2);
  });

  it('has no total when any checkout could not be priced', () => {
    assert.equal(storefrontOutcome([cap([['MUG', 2]], null)]).total, null);
  });
});
