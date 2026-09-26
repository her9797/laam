import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatDateTime } from "@/lib/utils";

import type { Bill, BillListQuery, BillPageResult } from "./model";

const useBillsPageQueryMock = vi.fn();
const refetchMock = vi.fn();

vi.mock("./queries", () => ({
  useBillsPageQuery: (query: unknown, enabled: unknown) => useBillsPageQueryMock(query, enabled),
}));

import { BillListView } from "./BillListView";

const PAID_BILL: Bill = {
  id: "bill-1",
  posOrderId: "pos-1",
  tableNumber: "5",
  status: "PAID",
  openedAt: "2026-01-10T12:00:00Z",
  completedAt: "2026-01-10T13:30:00Z",
  totalAmount: 50000,
  paidAmount: 50000,
  payments: [
    { sourceType: "CARD", paymentMethod: "CARD", amount: 30000, state: "APPROVED" },
    { sourceType: "CASH", paymentMethod: "CASH", amount: 20000, state: "APPROVED" },
    { sourceType: "CARD", paymentMethod: "CARD", amount: 10000, state: "CANCELLED" },
  ],
  menuCount: 5,
  menuPreview: ["Beer", "Cider", "Wine"],
};

const OPEN_BILL: Bill = {
  id: "bill-2",
  posOrderId: "pos-2",
  tableNumber: "6",
  status: "OPEN",
  openedAt: "2026-01-10T14:00:00Z",
  totalAmount: 12000,
  paidAmount: 0,
  payments: [],
  menuCount: 1,
  menuPreview: ["Highball"],
};

const CANCELLED_BILL: Bill = {
  id: "bill-3",
  posOrderId: "pos-3",
  tableNumber: "7",
  status: "CANCELLED",
  openedAt: "2026-01-10T15:00:00Z",
  cancelledAt: "2026-01-10T15:10:00Z",
  totalAmount: 8000,
  paidAmount: 0,
  payments: [{ sourceType: "CASH", paymentMethod: "CASH", amount: 8000, state: "CANCELLED" }],
  menuCount: 1,
  menuPreview: ["Soju"],
};

const BILLS = [PAID_BILL, OPEN_BILL, CANCELLED_BILL];

const QUERY: BillListQuery = {
  page: 1,
  pageSize: 20,
  search: "",
  dateFrom: "2026-01-01",
  dateTo: "2026-01-10",
};

function pageFixture(items: Bill[], overrides: Partial<BillPageResult> = {}): BillPageResult {
  return { items, page: 1, pageSize: 20, total: items.length, ...overrides };
}

function mockQuery(overrides: Record<string, unknown> = {}) {
  useBillsPageQueryMock.mockReturnValue({
    data: pageFixture(BILLS),
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    isPlaceholderData: false,
    isError: false,
    error: null,
    refetch: refetchMock,
    ...overrides,
  });
}

function renderView(props: Partial<Parameters<typeof BillListView>[0]> = {}) {
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();
  render(
    <BillListView
      query={QUERY}
      enabled
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      {...props}
    />,
  );
  return { onPageChange, onPageSizeChange };
}

function rowOf(bill: Bill): HTMLElement {
  return screen.getByRole("link", { name: formatDateTime(bill.openedAt, "ko") }).closest("tr") as HTMLElement;
}

describe("BillListView", () => {
  beforeEach(() => {
    useBillsPageQueryMock.mockReset();
    refetchMock.mockReset();
    mockQuery();
  });

  afterEach(() => {
    cleanup();
  });

  it("passes the query and the enabled flag through to the bill query", () => {
    renderView({ enabled: false });

    expect(useBillsPageQueryMock).toHaveBeenCalledWith(QUERY, false);
  });

  it("shows a skeleton table while the first page loads", () => {
    mockQuery({ data: undefined, isLoading: true, isSuccess: false });

    renderView();

    const status = screen.getByRole("status", { name: "계산서를 불러오는 중입니다." });
    expect(within(status).getByRole("table")).toBeInTheDocument();
  });

  it("replaces the list with an error state and a working retry when the first load fails", () => {
    mockQuery({ data: undefined, isSuccess: false, isError: true, error: new Error("boom") });

    renderView();

    expect(screen.getByRole("alert")).toHaveTextContent("계산서를 불러오지 못했습니다.");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the rows with an inline error when a refetch fails after data was loaded", () => {
    mockQuery({ isError: true, error: new Error("boom") });

    renderView();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(within(rowOf(PAID_BILL)).getByText("5")).toBeInTheDocument();
  });

  it("shows the empty state when there are no bills and no filter", () => {
    mockQuery({ data: pageFixture([]) });

    renderView();

    expect(screen.getByText("계산서가 없습니다.")).toBeInTheDocument();
  });

  it("shows the no-results state when a filter is active", () => {
    mockQuery({ data: pageFixture([]) });

    renderView({ query: { ...QUERY, status: "PAID" } });

    expect(screen.getByText("검색 결과가 없습니다.")).toBeInTheDocument();
  });

  it("renders the total bill count", () => {
    renderView();

    expect(screen.getByText("총 3건")).toBeInTheDocument();
  });

  it("renders each bill's table, total amount, and status label", () => {
    renderView();

    const paidRow = rowOf(PAID_BILL);
    expect(within(paidRow).getByText("5")).toBeInTheDocument();
    expect(within(paidRow).getByText("₩50,000")).toBeInTheDocument();
    expect(within(paidRow).getByText("결제 완료")).toHaveClass("text-success");

    const openRow = rowOf(OPEN_BILL);
    expect(within(openRow).getByText("₩12,000")).toBeInTheDocument();
    expect(within(openRow).getByText("결제 대기")).toHaveClass("text-warning");

    expect(within(rowOf(CANCELLED_BILL)).getByText("취소")).toHaveClass("text-muted-foreground");
  });

  it("shows the payment time under the order time only for a paid bill", () => {
    renderView();

    expect(
      within(rowOf(PAID_BILL)).getByText(`결제 ${formatDateTime(PAID_BILL.completedAt as string, "ko")}`),
    ).toBeInTheDocument();
    expect(within(rowOf(OPEN_BILL)).queryByText(/^결제 \d/)).not.toBeInTheDocument();
  });

  it("links each bill to its detail route", () => {
    renderView();

    expect(screen.getByRole("link", { name: formatDateTime(PAID_BILL.openedAt, "ko") })).toHaveAttribute(
      "href",
      "/orders/bills/bill-1",
    );
    expect(screen.getByRole("link", { name: formatDateTime(OPEN_BILL.openedAt, "ko") })).toHaveAttribute(
      "href",
      "/orders/bills/bill-2",
    );
  });

  it("summarises payments by method and marks cancelled payments instead of counting them as paid", () => {
    renderView();

    const paidRow = rowOf(PAID_BILL);
    expect(within(paidRow).getByText("카드 30,000 · 현금 20,000")).toBeInTheDocument();
    const cancelled = within(paidRow).getByText("카드 10,000 취소");
    expect(cancelled).toHaveClass("line-through");

    expect(within(rowOf(CANCELLED_BILL)).getByText("현금 8,000 취소")).toBeInTheDocument();
    expect(within(rowOf(OPEN_BILL)).getByText("-")).toBeInTheDocument();
  });

  it("expands a row to show its menu preview with the remaining count", () => {
    renderView();

    const toggle = within(rowOf(PAID_BILL)).getByRole("button", { name: "메뉴 5개" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Beer · Cider · Wine 외 2건")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByText("Beer · Cider · Wine 외 2건");
    expect(panel.closest("[id]")).toHaveAttribute("id", toggle.getAttribute("aria-controls"));

    fireEvent.click(toggle);
    expect(screen.queryByText("Beer · Cider · Wine 외 2건")).not.toBeInTheDocument();
  });

  it("omits the remaining count when the preview covers every menu row", () => {
    renderView();

    fireEvent.click(within(rowOf(OPEN_BILL)).getByRole("button", { name: "메뉴 1개" }));

    expect(screen.getByText("Highball")).toBeInTheDocument();
  });

  it("calls onPageChange from the pagination", () => {
    mockQuery({ data: pageFixture(BILLS, { total: 45 }) });

    const { onPageChange } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageSizeChange from the page-size picker", () => {
    mockQuery({ data: pageFixture(BILLS, { total: 45 }) });

    const { onPageSizeChange } = renderView();
    fireEvent.change(screen.getByRole("combobox", { name: "페이지당 개수" }), { target: { value: "30" } });

    expect(onPageSizeChange).toHaveBeenCalledWith(30);
  });

  it("keeps the table horizontally scrollable on narrow screens", () => {
    renderView();

    const table = screen.getAllByRole("table")[0];
    expect(table.className).toMatch(/min-w-\[/);
    expect(table.closest('[data-slot="table-container"]')).toHaveClass("overflow-x-auto");
  });

  it("marks the list busy while a stale page is on screen", () => {
    mockQuery({ isFetching: true, isPlaceholderData: true });

    renderView();

    expect(screen.getAllByRole("table")[0].closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
  });
});
