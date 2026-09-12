import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nights, quote, ROOMS } from '../src/rooms.js';

test('nights between two dates', () => {
  assert.equal(nights('2026-10-01', '2026-10-04'), 3);
  assert.equal(nights('2026-10-04', '2026-10-01'), 0);
});

test('a quote multiplies the rate by the nights', () => {
  const q = quote('garden', '2026-10-01', '2026-10-03');
  assert.equal(q.nights, 2);
  assert.equal(q.subtotal, 36000);
});

test('every room has a positive rate', () => {
  for (const r of ROOMS) assert.ok(r.rate > 0, r.id);
});
