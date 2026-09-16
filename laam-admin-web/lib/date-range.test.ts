import { describe, expect, it } from "vitest";

import { defaultDateRangeDays, formatDateOnly, parseDateOnly, resolveCalendarDateRange } from "./date-range";

describe("parseDateOnly", () => {
  it("parses a well-formed YYYY-MM-DD string", () => {
    const date = parseDateOnly("2026-01-15");
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(0);
    expect(date?.getDate()).toBe(15);
  });

  it("rejects a malformed string", () => {
    expect(parseDateOnly("not-a-date")).toBeNull();
    expect(parseDateOnly("2026-1-15")).toBeNull();
    expect(parseDateOnly("")).toBeNull();
  });

  it("rejects a calendar date that doesn't exist", () => {
    expect(parseDateOnly("2026-02-30")).toBeNull();
  });
});

describe("formatDateOnly", () => {
  it("formats a date as YYYY-MM-DD, zero-padded", () => {
    expect(formatDateOnly(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("resolveCalendarDateRange", () => {
  it("resolves a valid range to [from, to) with to expanded to the next midnight", () => {
    const result = resolveCalendarDateRange("2026-01-01", "2026-01-07");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(formatDateOnly(result.from)).toBe("2026-01-01");
      expect(formatDateOnly(result.to)).toBe("2026-01-08");
    }
  });

  it("covers a same-date range as one whole day", () => {
    const result = resolveCalendarDateRange("2026-01-01", "2026-01-01");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(formatDateOnly(result.to)).toBe("2026-01-02");
    }
  });

  it("rejects an inverted range", () => {
    expect(resolveCalendarDateRange("2026-01-07", "2026-01-01")).toEqual({ ok: false });
  });

  it("rejects malformed input", () => {
    expect(resolveCalendarDateRange("", "2026-01-01")).toEqual({ ok: false });
    expect(resolveCalendarDateRange("2026-01-01", "not-a-date")).toEqual({ ok: false });
  });
});

describe("defaultDateRangeDays", () => {
  it("returns the last N days up to and including the reference date", () => {
    const reference = new Date(2026, 0, 15);
    expect(defaultDateRangeDays(7, reference)).toEqual({ from: "2026-01-08", to: "2026-01-15" });
  });

  it("only reads the reference's calendar date, not its time-of-day", () => {
    const reference = new Date(2026, 0, 15, 23, 59, 59);
    expect(defaultDateRangeDays(7, reference).to).toBe("2026-01-15");
  });
});
