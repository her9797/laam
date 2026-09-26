/**
 * Display label for a payment order's `paymentMethod`, shared by every
 * screen that shows one (order detail, sales stats breakdown).
 *
 * `laam-api` now reports TossPlace `PaymentSourceType` values (`CARD`,
 * `CASH`, ...). Older rows can still carry the legacy `"POS"` placeholder
 * (POS-paid, actual method never captured), a Toss Payments method string
 * that is already human-readable (e.g. "카드", "간편결제"), or nothing.
 * Known codes map to translation keys in the `orders` namespace; any other
 * value is shown as-is rather than hidden, so a new upstream code stays
 * visible instead of silently collapsing into "unconfirmed".
 */
// A Map rather than an object literal so an arbitrary upstream string can't
// hit an inherited key (e.g. "constructor").
const PAYMENT_METHOD_LABEL_KEY = new Map<string, string>([
  ["CARD", "paymentMethodCard"],
  ["CASH", "paymentMethodCash"],
  ["ACCOUNT_TRANSFER", "paymentMethodAccountTransfer"],
  ["BARCODE", "paymentMethodBarcode"],
  ["PREPAID_VALUE", "paymentMethodPrepaidValue"],
  ["EXTERNAL", "paymentMethodExternal"],
  ["POS", "paymentMethodPosUnconfirmed"],
  ["UNDEFINED", "paymentMethodUnconfirmed"],
  ["", "paymentMethodUnconfirmed"],
]);

/** `t` must be bound to the `orders` namespace. */
export function paymentMethodLabel(method: string | undefined, t: (key: string) => string): string {
  const value = method ?? "";
  const labelKey = PAYMENT_METHOD_LABEL_KEY.get(value);
  return labelKey ? t(labelKey) : value;
}
