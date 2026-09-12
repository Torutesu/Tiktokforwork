// Prices on the booking site.
//
// Room rates are stored before tax. PRICE_DISPLAY decides what the guest sees:
//   'tax-exclusive' — the stored rate, labelled "before tax"
//   'tax-inclusive' — the rate with consumption tax added, labelled "tax included"

export const TAX_RATE = 0.10;
export const PRICE_DISPLAY = 'tax-exclusive';

export function withTax(yen, rate = TAX_RATE) {
  return Math.round(yen * (1 + rate));
}

export function displayPrice(yen, mode = PRICE_DISPLAY) {
  const amount = mode === 'tax-inclusive' ? withTax(yen) : yen;
  const label = mode === 'tax-inclusive' ? 'tax included' : 'before tax';
  return { amount, label, text: `¥${amount.toLocaleString('ja-JP')} (${label})` };
}
