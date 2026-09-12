import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from '../src/render.js';
import { ROOMS } from '../src/rooms.js';
import { displayPrice } from '../src/pricing.js';

test('the page lists every room with its displayed price', () => {
  const html = page();
  for (const r of ROOMS) {
    assert.ok(html.includes(r.name), r.name);
    assert.ok(html.includes(displayPrice(r.rate).text), `price of ${r.id}`);
  }
});

test('the page offers a way to pay', () => {
  assert.ok(page().includes('Pay with:'));
});
