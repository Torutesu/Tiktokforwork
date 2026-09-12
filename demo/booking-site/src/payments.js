// How a guest can pay at checkout.
export const PAYMENT_METHODS = [
  { id: 'card', name: 'Credit card', enabled: true },
  { id: 'bank', name: 'Bank transfer', enabled: true },
];

export function enabledMethods() {
  return PAYMENT_METHODS.filter((m) => m.enabled);
}
