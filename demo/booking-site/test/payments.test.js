import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enabledMethods, PAYMENT_METHODS } from '../src/payments.js';

test('only enabled methods are offered', () => {
  for (const m of enabledMethods()) assert.equal(m.enabled, true);
});

test('credit card is always available', () => {
  assert.ok(PAYMENT_METHODS.some((m) => m.id === 'card' && m.enabled));
});

test('method ids are unique', () => {
  const ids = PAYMENT_METHODS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});
