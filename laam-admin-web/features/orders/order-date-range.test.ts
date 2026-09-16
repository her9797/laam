import { describe, expect, it } from "vitest";

import { defaultOrderDateRange, resolveOrderDateRange } from "./order-date-range";

describe("resolveOrderDateRange", () => {
  it("resolves a picked date range to business-day bounds (16:00 open, 06:00 close)", () => {
    const result = resolveOrderDateRange("2026-01-10", "2026-01-11");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.from).toEqual(new Date(2026, 0, 10, 16, 0, 0, 0));
      expect(result.to).toEqual(new Date(2026, 0, 12, 6, 0, 0, 0));
    }
  });

  it("covers a same-date pick as that one business day", () => {
    const result = resolveOrderDateRange("2026-01-10", "2026-01-10");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.from).toEqual(new Date(2026, 0, 10, 16, 0, 0, 0));
      expect(result.to).toEqual(new Date(2026, 0, 11, 6, 0, 0, 0));
    }
  });

  it("rejects an inverted range", () => {
    expect(resolveOrderDateRange("2026-01-11", "2026-01-10")).toEqual({ ok: false });
  });

  it("rejects malformed input", () => {
    expect(resolveOrderDateRange("", "2026-01-10")).toEqual({ ok: false });
    expect(resolveOrderDateRange("2026-01-10", "not-a-date")).toEqual({ ok: false });
  });
});

describe("defaultOrderDateRange", () => {
  it("spans the last 7 business days up to and including today's business-day label", () => {
    // 03:00 is before the 06:00 close, so "today"'s business day is the
    // one that opened the previous calendar day (the 14th) — same
    // convention as `getDatePresetRange("today")`.
    const reference = new Date(2026, 0, 15, 3, 0, 0, 0);
    expect(defaultOrderDateRange(reference)).toEqual({ from: "2026-01-07", to: "2026-01-14" });
  });
});
