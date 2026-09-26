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

const UNCONFIRMED_PAYMENT_METHOD = "UNDEFINED";

type PaymentMethodBreakdownRow = {
  paymentMethod: string | null | undefined;
  revenue: number;
  orderCount: number;
};

/**
 * Collapses breakdown rows whose `paymentMethod` is some spelling of
 * "unconfirmed" (`UNDEFINED`, empty/whitespace, null/undefined) into a single
 * `UNDEFINED` row, summing revenue and order count, so the chart shows one
 * "미확인" slice instead of one per raw spelling. Every other value is kept
 * as its own row. Result is ordered by revenue descending (stable, so ties
 * keep the API's order), matching the API's own ordering. Does not mutate
 * the input.
 */
export function mergePaymentMethodStats(
  rows: readonly PaymentMethodBreakdownRow[],
): Array<{ paymentMethod: string; revenue: number; orderCount: number }> {
  const merged = new Map<string, { paymentMethod: string; revenue: number; orderCount: number }>();
  for (const row of rows) {
    const raw = row.paymentMethod ?? "";
    const key = raw.trim() === "" || raw === UNCONFIRMED_PAYMENT_METHOD ? UNCONFIRMED_PAYMENT_METHOD : raw;
    const existing = merged.get(key);
    if (existing) {
      existing.revenue += row.revenue;
      existing.orderCount += row.orderCount;
    } else {
      merged.set(key, { paymentMethod: key, revenue: row.revenue, orderCount: row.orderCount });
    }
  }
  return [...merged.values()].sort((a, b) => b.revenue - a.revenue);
}
