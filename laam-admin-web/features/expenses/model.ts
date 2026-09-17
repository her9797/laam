/**
 * Types mirror the admin expense contract served by `laam-api` under
 * `/api/v1/admin` (reached through the `/api/admin/*` BFF). Amounts are
 * whole won, quantities are integers, `date` is the calendar day the
 * operator picked ('YYYY-MM-DD') and months are 'YYYY-MM' in store time
 * (Asia/Seoul).
 */

export type PaymentMethod = "card" | "cash" | "transfer";

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["card", "cash", "transfer"];

/** Translation keys in the `expenses` namespace. */
export const PAYMENT_METHOD_LABEL_KEYS: Record<PaymentMethod, string> = {
  card: "paymentCard",
  cash: "paymentCash",
  transfer: "paymentTransfer",
};

export type ExpenseReceiptLine = {
  id: string;
  itemId: string | null;
  /** Item name snapshot for an item line, the description otherwise. */
  itemName: string;
  categoryId: string;
  description: string;
  /** `null` on an "other expense" line. */
  quantity: number | null;
  amount: number;
};

export type ExpenseReceipt = {
  id: string;
  date: string;
  vendor: string;
  paymentMethod: PaymentMethod;
  memo: string;
  total: number;
  hasImage: boolean;
  lines: ExpenseReceiptLine[];
  createdAt: string;
  updatedAt: string;
};

export type ExpenseReceiptLineInput =
  | { itemId: string; quantity: number; amount: number }
  | { categoryId: string; description: string; amount: number };

export type ExpenseReceiptInput = {
  date: string;
  vendor: string;
  paymentMethod: PaymentMethod;
  memo: string;
  lines: ExpenseReceiptLineInput[];
};

export type ExpenseSummary = {
  month: string;
  total: number;
  previousMonthTotal: number;
  receiptCount: number;
  byCategory: Array<{ categoryId: string; name: string; amount: number }>;
};

export type ReceiptImageUrl = { url: string; expiresAt: string };

export const VENDOR_MAX_LENGTH = 100;
export const MEMO_MAX_LENGTH = 500;
export const RECEIPT_MAX_LINES = 100;

/**
 * A receipt line while it is being edited. `amount` keeps the text shown in
 * the input (with thousands separators) so typing is never reformatted
 * under the cursor beyond the separators themselves.
 */
export type DraftLine =
  | { key: string; kind: "item"; itemId: string | null; itemName?: string; quantity: number; amount: string }
  | { key: string; kind: "other"; categoryId: string | null; description: string; amount: string };

/** Keeps only digits and adds thousands separators ("0012" → "12"). */
export function formatAmountInput(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Whole, non-negative won from a (possibly formatted) input, else `null`. */
export function parseAmountInput(value: string): number | null {
  const compact = value.replace(/,/g, "").trim();
  if (!/^\d+$/.test(compact)) {
    return null;
  }
  const parsed = Number(compact);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function calculateDraftTotal(lines: DraftLine[]): number {
  return lines.reduce((sum, line) => sum + (parseAmountInput(line.amount) ?? 0), 0);
}

export type MonthComparison = { kind: "less" | "more" | "same"; difference: number };

export function compareWithPreviousMonth(total: number, previousMonthTotal: number): MonthComparison {
  const difference = total - previousMonthTotal;
  if (difference === 0) {
    return { kind: "same", difference: 0 };
  }
  return { kind: difference < 0 ? "less" : "more", difference: Math.abs(difference) };
}

type QuantityLine = { itemId: string | null; quantity: number | null };

/**
 * The inventory change a receipt save/delete causes, computed the way the
 * server applies it: per item, (sum of new quantities) − (sum of old
 * quantities). Items keep first-appearance order (old lines, then new);
 * unchanged items are left out.
 */
export function diffInventoryQuantities(
  before: QuantityLine[],
  after: QuantityLine[],
): Array<{ itemId: string; delta: number }> {
  const deltas = new Map<string, number>();
  const add = (lines: QuantityLine[], sign: 1 | -1) => {
    for (const line of lines) {
      if (line.itemId === null || line.quantity === null) continue;
      deltas.set(line.itemId, (deltas.get(line.itemId) ?? 0) + sign * line.quantity);
    }
  };
  add(before, -1);
  add(after, 1);
  return [...deltas]
    .filter(([, delta]) => delta !== 0)
    .map(([itemId, delta]) => ({ itemId, delta }));
}

const SEOUL_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's calendar date in store time, 'YYYY-MM-DD'. */
export function seoulToday(now: Date): string {
  const parts = Object.fromEntries(SEOUL_DATE.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function seoulMonth(now: Date): string {
  return seoulToday(now).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

export function parseMonthParam(value: string | null): string | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return null;
  }
  return value;
}

export function groupReceiptsByDate(
  receipts: ExpenseReceipt[],
): Array<{ date: string; receipts: ExpenseReceipt[] }> {
  const groups: Array<{ date: string; receipts: ExpenseReceipt[] }> = [];
  for (const receipt of receipts) {
    const last = groups.at(-1);
    if (last && last.date === receipt.date) {
      last.receipts.push(receipt);
    } else {
      groups.push({ date: receipt.date, receipts: [receipt] });
    }
  }
  return groups;
}

/** Distinct non-blank vendors in the given (newest-first) receipts. */
export function recentVendors(receipts: ExpenseReceipt[], limit: number): string[] {
  const vendors: string[] = [];
  for (const receipt of receipts) {
    const vendor = receipt.vendor.trim();
    if (vendor && !vendors.includes(vendor)) {
      vendors.push(vendor);
      if (vendors.length === limit) break;
    }
  }
  return vendors;
}
