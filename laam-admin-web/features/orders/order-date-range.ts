/**
 * Order-history screen's from/to date filter — resolves the operator's two
 * picked dates (`<input type="date">`, `YYYY-MM-DD`) to absolute [from, to)
 * instants under the venue's business day (16:00-06:00, buffered; see
 * `./business-day`). This is the same basis the screen's former preset
 * selector ("오늘"/"최근 7일"/...) always used — order history has always
 * been business-day scoped, so this keeps that behavior fixed rather than
 * exposing a basis toggle like the sales-stats screen's.
 */
import { formatDateOnly, parseDateOnly, type DateRangeResult } from "@/lib/date-range";

import { getBusinessDayBoundsForDate, getDatePresetRange } from "./business-day";

/**
 * `to` resolves to the *end* of the business day it labels, so a range
 * where `from` and `to` are the same picked date still covers that whole
 * business day, not zero orders.
 */
export function resolveOrderDateRange(fromDateStr: string, toDateStr: string): DateRangeResult {
  const fromDate = parseDateOnly(fromDateStr);
  const toDate = parseDateOnly(toDateStr);
  if (!fromDate || !toDate) {
    return { ok: false };
  }
  if (fromDate.getTime() > toDate.getTime()) {
    return { ok: false };
  }

  const from = getBusinessDayBoundsForDate(fromDate).start;
  const to = getBusinessDayBoundsForDate(toDate).end;
  return { ok: true, from, to };
}

const DEFAULT_RANGE_SPAN_DAYS = 7;

/**
 * The screen's initial range on first load: the 7 business days up to and
 * including "today" — under the buffered close-hour rule, that's the date
 * label `getDatePresetRange("today")` resolves to (which may be
 * yesterday's date before the buffer), not necessarily the calendar date
 * the operator's clock currently shows.
 */
export function defaultOrderDateRange(reference: Date = new Date()): { from: string; to: string } {
  const todayLabel = getDatePresetRange("today", reference).from ?? reference;
  const from = new Date(todayLabel);
  from.setDate(from.getDate() - DEFAULT_RANGE_SPAN_DAYS);
  return { from: formatDateOnly(from), to: formatDateOnly(todayLabel) };
}
