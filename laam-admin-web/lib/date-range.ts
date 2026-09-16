/**
 * Shared date-only (`YYYY-MM-DD`) parsing/formatting/range resolution for
 * the admin list screens' from/to date filters (`features/requests`,
 * `features/special-requests`) — plain calendar-day boundaries, unlike
 * `features/orders/order-date-range.ts`'s business-day-aware version for
 * the order-history screen, and smaller than
 * `features/orders/stats/date-range.ts`'s day-basis-toggle version for the
 * sales-stats screen. Request/special-request lists have no prior
 * "business day" convention of their own, so plain calendar days keep
 * their date filter simple.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateOnly(value: string): Date | null {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Guards against e.g. "2026-02-30", which `Date` would otherwise silently
  // roll forward into March.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type DateRangeResult = { ok: true; from: Date; to: Date } | { ok: false };

/**
 * Resolves the picked `[fromDateStr, toDateStr]` range to an absolute
 * `[from, to)` instant range under plain calendar-day boundaries. `to` is
 * expanded to the *start of the next day*, so a range where `from` and
 * `to` are the same date still covers that entire day, not zero rows.
 */
export function resolveCalendarDateRange(fromDateStr: string, toDateStr: string): DateRangeResult {
  const fromDate = parseDateOnly(fromDateStr);
  const toDate = parseDateOnly(toDateStr);
  if (!fromDate || !toDate) {
    return { ok: false };
  }
  if (fromDate.getTime() > toDate.getTime()) {
    return { ok: false };
  }

  const to = new Date(toDate);
  to.setDate(to.getDate() + 1);
  return { ok: true, from: fromDate, to };
}

/** The last `days` days up to and including `reference`'s calendar date. */
export function defaultDateRangeDays(days: number, reference: Date = new Date()): { from: string; to: string } {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const from = new Date(today);
  from.setDate(from.getDate() - days);
  return { from: formatDateOnly(from), to: formatDateOnly(today) };
}
