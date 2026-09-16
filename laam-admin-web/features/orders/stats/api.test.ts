import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/lib/api/fetch-json";

import { fetchSalesStats } from "./api";

vi.mock("@/lib/api/fetch-json", () => ({ fetchJson: vi.fn() }));

describe("fetchSalesStats", () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset().mockResolvedValue({
      summary: { totalRevenue: 0, orderCount: 0, averageOrderValue: 0 },
      trend: { unit: "day", buckets: [] },
      byCategory: [],
      byPaymentMethod: [],
      byTable: [],
    });
  });

  it("sends from/to as ISO instants and dayBasis to the payment-orders stats endpoint", async () => {
    await fetchSalesStats(new Date(2026, 0, 1, 0, 0, 0, 0), new Date(2026, 1, 1, 0, 0, 0, 0), "business");

    const [path] = vi.mocked(fetchJson).mock.calls[0];
    const url = new URL(String(path), "http://localhost");
    expect(url.pathname).toBe("/api/admin/payment-orders/stats");
    expect(url.searchParams.get("from")).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).toISOString());
    expect(url.searchParams.get("to")).toBe(new Date(2026, 1, 1, 0, 0, 0, 0).toISOString());
    expect(url.searchParams.get("dayBasis")).toBe("business");
  });

  it("sends dayBasis=calendar when the calendar basis is picked", async () => {
    await fetchSalesStats(new Date(2026, 0, 1, 0, 0, 0, 0), new Date(2026, 1, 1, 0, 0, 0, 0), "calendar");

    const [path] = vi.mocked(fetchJson).mock.calls[0];
    const url = new URL(String(path), "http://localhost");
    expect(url.searchParams.get("dayBasis")).toBe("calendar");
  });
});
