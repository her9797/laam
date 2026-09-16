/**
 * The order-history screen's date-range presets are anchored to the venue's
 * business day, not the calendar day: a bar/lounge's "today" runs from
 * evening into the small hours, so a calendar-midnight boundary would
 * arbitrarily split one night's orders in half.
 *
 * The nominal hours are 18:00-04:00, but per the operator's own guidance
 * ("영업일은 혹시 모르니 앞뒤로 2시간 일찍 또는 연장해서 진행해줘") the boundary is
 * buffered two hours on each side — 16:00 open, 06:00 close — so an
 * occasional early open or a night that runs long still lands in the
 * correct business day instead of spilling into the next one.
 *
 * All computation here reads the local wall-clock time (`Date`'s
 * local-time accessors), matching the operator's own device clock — this
 * module is meant to run in the browser, not on the server, precisely so
 * no server-side timezone policy is needed (see `laam-api`'s
 * `formatTimestamp`, which stores/serializes everything in UTC).
 */

const BUSINESS_DAY_OPEN_HOUR = 16;
const BUSINESS_DAY_CLOSE_HOUR = 6;

export type DatePreset = "today" | "last7" | "last30" | "all";

/**
 * The current business day's [start, end) window, evaluated at `reference`.
 *
 * Before the close-hour buffer, the current business day is the one that
 * opened the previous calendar day. At or after it (including the closed
 * gap before that evening's opening), the current business day is the one
 * opening later today — a forward-looking window that may not have started
 * yet, which keeps the rule a single, deterministic function of the clock
 * rather than needing to track whether the venue happens to be open right
 * now.
 */
function getCurrentBusinessDayRange(reference: Date): { start: Date; end: Date } {
  const end = new Date(reference);
  end.setHours(BUSINESS_DAY_CLOSE_HOUR, 0, 0, 0);
  if (reference.getHours() >= BUSINESS_DAY_CLOSE_HOUR) {
    end.setDate(end.getDate() + 1);
  }

  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  start.setHours(BUSINESS_DAY_OPEN_HOUR, 0, 0, 0);

  return { start, end };
}

function rollingWindowEndingAtCurrentBoundary(reference: Date, days: number): { from: Date; to: Date } {
  const { end } = getCurrentBusinessDayRange(reference);
  const from = new Date(end);
  from.setDate(from.getDate() - days);
  return { from, to: end };
}

/**
 * The business day *labeled* by `date`'s calendar date (only its
 * year/month/day are read — any time-of-day component is ignored): 16:00
 * that date through 06:00 the next. Unlike `getDatePresetRange("today")`,
 * which is always relative to "now", this resolves an arbitrary
 * operator-picked date — the sales-stats screen's date-range inputs use it
 * to convert a picked "from"/"to" date into absolute instants under the
 * "business day" aggregation basis (see `features/orders/stats/date-range.ts`).
 */
export function getBusinessDayBoundsForDate(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), BUSINESS_DAY_OPEN_HOUR, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(BUSINESS_DAY_CLOSE_HOUR, 0, 0, 0);
  return { start, end };
}

/**
 * Resolves a date-range preset to an absolute `[from, to)` bound, or
 * `{ from: undefined, to: undefined }` for "all" (no bound). `reference`
 * defaults to now and is only overridden in tests.
 */
export function getDatePresetRange(
  preset: DatePreset,
  reference: Date = new Date(),
): { from?: Date; to?: Date } {
  switch (preset) {
    case "all":
      return {};
    case "today": {
      const { start, end } = getCurrentBusinessDayRange(reference);
      return { from: start, to: end };
    }
    case "last7":
      return rollingWindowEndingAtCurrentBoundary(reference, 7);
    case "last30":
      return rollingWindowEndingAtCurrentBoundary(reference, 30);
    default:
      return preset satisfies never;
  }
}
