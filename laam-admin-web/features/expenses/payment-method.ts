import { PAYMENT_METHODS, type PaymentMethod } from "./model";

export const LAST_PAYMENT_METHOD_KEY = "laam-admin:last-payment-method";

const DEFAULT_PAYMENT_METHOD: PaymentMethod = "card";

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return PAYMENT_METHODS.includes(value as PaymentMethod);
}

/**
 * The payment method a new receipt starts with: the one used last on this
 * device. Storage can be blocked (private mode, disabled site data), so any
 * failure just falls back to card.
 */
export function readLastPaymentMethod(): PaymentMethod {
  try {
    const stored = window.localStorage.getItem(LAST_PAYMENT_METHOD_KEY);
    return isPaymentMethod(stored) ? stored : DEFAULT_PAYMENT_METHOD;
  } catch {
    return DEFAULT_PAYMENT_METHOD;
  }
}

export function rememberPaymentMethod(method: PaymentMethod): void {
  try {
    window.localStorage.setItem(LAST_PAYMENT_METHOD_KEY, method);
  } catch {
    // Only a convenience default; nothing to recover.
  }
}
