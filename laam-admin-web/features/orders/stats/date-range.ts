/**
 * Converts the sales-stats screen's two `<input type="date">` values
 * (`YYYY-MM-DD`, no time) into the absolute `[from, to)` instant range
 * `GET /api/v1/admin/payment-orders/stats` expects — under whichever
 * `DayBasis` the operator has selected for the screen.
 *
 * "calendar" treats each picked date as a plain midnight-to-midnight day.
 * "business" treats it as the venue's buffered business day (16:00-06:00,
 * see `../business-day.ts`) that *opens* on that date — the same
 * convention the order-history screen's date presets use, and for the
 * same reason: a bar/lounge's day runs from evening into the small hours,
 * so a calendar-midnight boundary would arbitrarily split one night's
 * orders in half.
 *
 * Parsing happens in the browser, against the operator's own local clock,
 * for the same reason `business-day.ts` does: it keeps `laam-api` free of
 * any server-side timezone policy for filtering.
 */
import { getBusinessDayBoundsForDate, getDatePresetRange } from "../business-day";

export type DayBasis = "business" | "calendar";

export type DateRangeResult = { ok: true; from: Date; to: Date } | { ok: false };

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string): Date | null {
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

function calendarDayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  const end = new Date(date);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function boundsForBasis(basis: DayBasis, date: Date): { start: Date; end: Date } {
  return basis === "business" ? getBusinessDayBoundsForDate(date) : calendarDayBounds(date);
}

/**
 * Resolves the picked `[fromDateStr, toDateStr]` range to an absolute
 * `[from, to)` instant range under `basis`. `to` is expanded to the *end*
 * of the day/business-day it labels, so a range where `from` and `to` are
 * the same date still covers that entire day, not zero orders.
 */
export function resolveDateRange(fromDateStr: string, toDateStr: string, basis: DayBasis): DateRangeResult {
  const fromDate = parseDateOnly(fromDateStr);
  const toDate = parseDateOnly(toDateStr);
  if (!fromDate || !toDate) {
    return { ok: false };
  }
  if (fromDate.getTime() > toDate.getTime()) {
    return { ok: false };
  }

  const from = boundsForBasis(basis, fromDate).start;
  const to = boundsForBasis(basis, toDate).end;
  return { ok: true, from, to };
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DEFAULT_RANGE_SPAN_DAYS = 30;

/**
 * The screen's initial range on first load: the 30 days up to and
 * including "today" under `basis` — under "business", that's the date
 * label `getDatePresetRange("today")` resolves to (which may be
 * yesterday's date before the buffered close), not necessarily the
 * calendar date the operator's clock currently shows.
 */
export function defaultDateRange(basis: DayBasis, reference: Date = new Date()): { from: string; to: string } {
  const todayLabel =
    basis === "business"
      ? (getDatePresetRange("today", reference).from ?? reference)
      : new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());

  const from = new Date(todayLabel);
  from.setDate(from.getDate() - DEFAULT_RANGE_SPAN_DAYS);
  return { from: formatDateOnly(from), to: formatDateOnly(todayLabel) };
}
