import { describe, expect, it } from "vitest";

import { getBusinessDayBoundsForDate, getDatePresetRange } from "./business-day";

// All Date values in this file are constructed with the local-time
// constructor (`new Date(y, m, d, h, ...)`), and the module under test also
// reads local wall-clock time (`getHours()`/`getDate()`). Both therefore
// agree regardless of the machine's actual system timezone running the
// test — there is nothing here that depends on truly being KST. In
// production, the "local" clock is the operator's own device (expected to
// be set to Korea time), which is exactly the assumption `business-day.ts`
// documents.
describe("getDatePresetRange", () => {
  it("returns no bounds for the 'all' preset", () => {
    const range = getDatePresetRange("all", new Date(2026, 0, 10, 20, 0));
    expect(range.from).toBeUndefined();
    expect(range.to).toBeUndefined();
  });

  it("before the 04:00 close (buffered to 06:00), 'today' is yesterday 16:00 to today 06:00", () => {
    const range = getDatePresetRange("today", new Date(2026, 0, 10, 3, 30));
    expect(range.from).toEqual(new Date(2026, 0, 9, 16, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 0, 10, 6, 0, 0, 0));
  });

  it("exactly at the 06:00 buffer boundary, 'today' has already rolled to the next window", () => {
    const range = getDatePresetRange("today", new Date(2026, 0, 10, 6, 0, 0, 0));
    expect(range.from).toEqual(new Date(2026, 0, 10, 16, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 0, 11, 6, 0, 0, 0));
  });

  it("one minute before the 06:00 buffer boundary, 'today' is still the closing window", () => {
    const range = getDatePresetRange("today", new Date(2026, 0, 10, 5, 59, 0, 0));
    expect(range.from).toEqual(new Date(2026, 0, 9, 16, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 0, 10, 6, 0, 0, 0));
  });

  it("during the closed gap between 06:00 and 16:00, 'today' looks ahead to tonight's opening", () => {
    const range = getDatePresetRange("today", new Date(2026, 0, 10, 12, 0, 0, 0));
    expect(range.from).toEqual(new Date(2026, 0, 10, 16, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 0, 11, 6, 0, 0, 0));
  });

  it("exactly at the 16:00 buffer boundary (an early open), 'today' is already open", () => {
    const range = getDatePresetRange("today", new Date(2026, 0, 10, 16, 0, 0, 0));
    expect(range.from).toEqual(new Date(2026, 0, 10, 16, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 0, 11, 6, 0, 0, 0));
  });

  it("late at night, 'today' covers tonight 16:00 through tomorrow 06:00", () => {
    const range = getDatePresetRange("today", new Date(2026, 0, 10, 23, 0, 0, 0));
    expect(range.from).toEqual(new Date(2026, 0, 10, 16, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 0, 11, 6, 0, 0, 0));
  });

  it("'last7' is a rolling 7-day window ending at the same boundary as 'today'", () => {
    const range = getDatePresetRange("last7", new Date(2026, 0, 10, 20, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 0, 11, 6, 0, 0, 0));
    expect(range.from).toEqual(new Date(2026, 0, 4, 6, 0, 0, 0));
  });

  it("'last30' is a rolling 30-day window ending at the same boundary as 'today'", () => {
    const range = getDatePresetRange("last30", new Date(2026, 0, 10, 20, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 0, 11, 6, 0, 0, 0));
    expect(range.from).toEqual(new Date(2025, 11, 12, 6, 0, 0, 0));
  });
});

describe("getBusinessDayBoundsForDate", () => {
  it("labels the business day by the calendar date it opens on: 16:00 that date through 06:00 the next", () => {
    const bounds = getBusinessDayBoundsForDate(new Date(2026, 0, 10, 0, 0, 0, 0));
    expect(bounds.start).toEqual(new Date(2026, 0, 10, 16, 0, 0, 0));
    expect(bounds.end).toEqual(new Date(2026, 0, 11, 6, 0, 0, 0));
  });

  it("ignores any time-of-day component on the input, using only its calendar date", () => {
    const bounds = getBusinessDayBoundsForDate(new Date(2026, 0, 10, 23, 45, 0, 0));
    expect(bounds.start).toEqual(new Date(2026, 0, 10, 16, 0, 0, 0));
    expect(bounds.end).toEqual(new Date(2026, 0, 11, 6, 0, 0, 0));
  });
});
