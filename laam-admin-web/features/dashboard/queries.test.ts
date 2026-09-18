import { describe, expect, it, vi } from "vitest";

const fetchSalesStatsMock = vi.fn();

vi.mock("@/features/orders/stats/api", () => ({
  fetchSalesStats: (...args: unknown[]) => fetchSalesStatsMock(...args),
}));

import { fetchTodaySales } from "./queries";

describe("fetchTodaySales", () => {
  it("uses the business day still open at 'now', not the one labeled by today's calendar date", async () => {
    // 02:00 on Sep 19 falls before the 06:00 close, so the still-open
    // business day is Sep 18 16:00 - Sep 19 06:00 (see business-day.ts's
    // getCurrentBusinessDayRange doc comment) — not Sep 19 16:00 - Sep 20
    // 06:00, which is what a same-calendar-date lookup would (wrongly)
    // return before that evening's opening.
    const now = new Date(2026, 8, 19, 2, 0, 0);
    fetchSalesStatsMock.mockResolvedValue({
      summary: { totalRevenue: 50000, orderCount: 3, averageOrderValue: 16667 },
    });

    await fetchTodaySales(now);

    expect(fetchSalesStatsMock).toHaveBeenCalledTimes(1);
    const [from, to, basis] = fetchSalesStatsMock.mock.calls[0] as [Date, Date, string];
    expect(from).toEqual(new Date(2026, 8, 18, 16, 0, 0, 0));
    expect(to).toEqual(new Date(2026, 8, 19, 6, 0, 0, 0));
    expect(basis).toBe("business");
  });

  it("resolves to the sales summary", async () => {
    fetchSalesStatsMock.mockResolvedValue({
      summary: { totalRevenue: 50000, orderCount: 3, averageOrderValue: 16667 },
    });

    const result = await fetchTodaySales(new Date(2026, 8, 19, 20, 0, 0));

    expect(result).toEqual({ totalRevenue: 50000, orderCount: 3, averageOrderValue: 16667 });
  });
});
