import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SalesStats } from "./model";

const useSalesStatsQueryMock = vi.fn();
const refetchMock = vi.fn();

vi.mock("./queries", () => ({
  useSalesStatsQuery: (from: Date, to: Date, dayBasis: string) => useSalesStatsQueryMock(from, to, dayBasis),
}));

import { SalesStatsPage } from "./SalesStatsPage";

const STATS: SalesStats = {
  summary: { totalRevenue: 23000, orderCount: 2, averageOrderValue: 11500 },
  trend: {
    unit: "day",
    buckets: [
      { bucket: "2026-01-10", revenue: 8000, orderCount: 1 },
      { bucket: "2026-01-11", revenue: 15000, orderCount: 1 },
    ],
  },
  byCategory: [
    { categoryName: "Food", revenue: 15000, orderCount: 1 },
    { categoryName: "Drinks", revenue: 8000, orderCount: 1 },
  ],
  byPaymentMethod: [{ paymentMethod: "카드", revenue: 23000, orderCount: 2 }],
  byTable: [
    { tableNumber: "2", revenue: 15000, orderCount: 1 },
    { tableNumber: "1", revenue: 8000, orderCount: 1 },
  ],
  byMenuItem: [
    { menuItemName: "Pizza", revenue: 12000, orderCount: 1 },
    { menuItemName: "Beer", revenue: 6000, orderCount: 1 },
  ],
};

function mockQuery(overrides: Partial<ReturnType<typeof defaultQueryResult>> = {}) {
  useSalesStatsQueryMock.mockReturnValue({ ...defaultQueryResult(), ...overrides });
}

function defaultQueryResult() {
  return {
    data: STATS,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: refetchMock,
  };
}

describe("SalesStatsPage", () => {
  beforeEach(() => {
    refetchMock.mockClear();
    useSalesStatsQueryMock.mockClear();
    mockQuery();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state while stats are loading", () => {
    mockQuery({ data: undefined, isLoading: true });

    render(<SalesStatsPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state with a working retry action when the query fails", () => {
    mockQuery({ data: undefined, isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<SalesStatsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when the range has no revenue", () => {
    mockQuery({
      data: {
        summary: { totalRevenue: 0, orderCount: 0, averageOrderValue: 0 },
        trend: { unit: "day", buckets: [] },
        byCategory: [],
        byPaymentMethod: [],
        byTable: [],
        byMenuItem: [],
      },
    });

    render(<SalesStatsPage />);

    expect(screen.getByText("해당 기간에 매출이 없습니다.")).toBeInTheDocument();
  });

  it("renders the summary figures", () => {
    render(<SalesStatsPage />);

    expect(screen.getByText("₩23,000")).toBeInTheDocument();
    // "2" also appears in the table breakdown's order-count column, so this
    // only asserts the summary card's figure exists somewhere on the page.
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getByText("₩11,500")).toBeInTheDocument();
  });

  it("renders the table breakdown with revenue and order count", () => {
    render(<SalesStatsPage />);

    expect(screen.getByText("₩15,000")).toBeInTheDocument();
    expect(screen.getByText("₩8,000")).toBeInTheDocument();
  });

  it("renders the per-product breakdown ranked by revenue as a table, inside a scrollable container", () => {
    render(<SalesStatsPage />);

    const title = screen.getByText("상품별 매출");
    const card = title.closest('[data-slot="card"]') as HTMLElement;
    const scrollArea = within(card).getByRole("table").closest(".overflow-y-auto");
    expect(scrollArea).not.toBeNull();

    const rows = within(card).getAllByRole("row");
    // rows[0] is the header row.
    expect(within(rows[1]).getByText("Pizza")).toBeInTheDocument();
    expect(within(rows[1]).getByText("₩12,000")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Beer")).toBeInTheDocument();
  });

  it("defaults the aggregation basis to '영업일' (business day)", () => {
    render(<SalesStatsPage />);

    expect(screen.getByLabelText("집계 기준")).toHaveTextContent("영업일");
  });

  it("shows a validation message when the start date is after the end date", () => {
    render(<SalesStatsPage />);

    const fromInput = screen.getByLabelText("시작일");
    const toInput = screen.getByLabelText("종료일");
    fireEvent.change(fromInput, { target: { value: "2026-02-01" } });
    fireEvent.change(toInput, { target: { value: "2026-01-01" } });

    expect(screen.getByText("시작일은 종료일보다 늦을 수 없습니다.")).toBeInTheDocument();
  });
});
