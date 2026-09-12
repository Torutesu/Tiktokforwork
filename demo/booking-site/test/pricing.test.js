import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTax, displayPrice, PRICE_DISPLAY } from '../src/pricing.js';

test('consumption tax is 10% and rounds to the yen', () => {
  assert.equal(withTax(1000), 1100);
  assert.equal(withTax(18000), 19800);
  assert.equal(withTax(333), 366);
});

test('tax-inclusive display adds the tax and says so', () => {
  const p = displayPrice(18000, 'tax-inclusive');
  assert.equal(p.amount, 19800);
  assert.equal(p.label, 'tax included');
});

test('tax-exclusive display shows the stored rate and says so', () => {
  const p = displayPrice(18000, 'tax-exclusive');
  assert.equal(p.amount, 18000);
  assert.equal(p.label, 'before tax');
});

test('the default display mode is one of the two and its label matches', () => {
  assert.ok(['tax-inclusive', 'tax-exclusive'].includes(PRICE_DISPLAY));
  const p = displayPrice(10000);
  assert.equal(p.label, PRICE_DISPLAY === 'tax-inclusive' ? 'tax included' : 'before tax');
  assert.equal(p.amount, PRICE_DISPLAY === 'tax-inclusive' ? 11000 : 10000);
});
