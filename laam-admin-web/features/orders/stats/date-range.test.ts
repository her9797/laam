import { describe, expect, it } from "vitest";

import { defaultDateRange, resolveDateRange } from "./date-range";

describe("resolveDateRange", () => {
  it("under the 'calendar' basis, converts [from, to] dates to midnight-to-midnight instants", () => {
    const result = resolveDateRange("2026-01-10", "2026-01-12", "calendar");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.from).toEqual(new Date(2026, 0, 10, 0, 0, 0, 0));
    // Exclusive upper bound: midnight of the day *after* `to`, so every
    // order placed on 2026-01-12 itself is still included.
    expect(result.to).toEqual(new Date(2026, 0, 13, 0, 0, 0, 0));
  });

  it("under the 'business' basis, converts [from, to] dates to 16:00-06:00 instants", () => {
    const result = resolveDateRange("2026-01-10", "2026-01-12", "business");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.from).toEqual(new Date(2026, 0, 10, 16, 0, 0, 0));
    // Exclusive upper bound: 06:00 the morning after the business day that
    // opened on `to`.
    expect(result.to).toEqual(new Date(2026, 0, 13, 6, 0, 0, 0));
  });

  it("rejects a blank from or to", () => {
    expect(resolveDateRange("", "2026-01-12", "business").ok).toBe(false);
    expect(resolveDateRange("2026-01-10", "", "business").ok).toBe(false);
  });

  it("rejects an unparseable date", () => {
    expect(resolveDateRange("not-a-date", "2026-01-12", "business").ok).toBe(false);
  });

  it("rejects from strictly after to", () => {
    expect(resolveDateRange("2026-01-12", "2026-01-10", "business").ok).toBe(false);
  });

  it("accepts from equal to to (a single day/business day)", () => {
    expect(resolveDateRange("2026-01-10", "2026-01-10", "calendar").ok).toBe(true);
    expect(resolveDateRange("2026-01-10", "2026-01-10", "business").ok).toBe(true);
  });
});

describe("defaultDateRange", () => {
  it("under the 'calendar' basis, spans the 30 days up to and including today's calendar date", () => {
    const range = defaultDateRange("calendar", new Date(2026, 0, 31, 15, 0, 0, 0));
    expect(range.from).toBe("2026-01-01");
    expect(range.to).toBe("2026-01-31");
  });

  it("under the 'business' basis, spans the 30 days up to and including today's business-day label", () => {
    // 20:00 is after the day opened at 16:00, so today's business day is
    // labeled by today's own calendar date (2026-01-31) — see
    // business-day.test.ts for the underlying boundary rules this defers to.
    const range = defaultDateRange("business", new Date(2026, 0, 31, 20, 0, 0, 0));
    expect(range.from).toBe("2026-01-01");
    expect(range.to).toBe("2026-01-31");
  });

  it("under the 'business' basis before the buffered close, today's business day is still labeled by yesterday's date", () => {
    // 03:00 is before the 06:00 close buffer, so "today" is still the
    // business day that opened yesterday evening.
    const range = defaultDateRange("business", new Date(2026, 0, 31, 3, 0, 0, 0));
    expect(range.from).toBe("2025-12-31");
    expect(range.to).toBe("2026-01-30");
  });
});
