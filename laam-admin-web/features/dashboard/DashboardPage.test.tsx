import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "@/features/bootstrap/model";
import type { OrderPageResult } from "@/features/orders/model";
import type { CustomerRequestPendingSummary } from "@/features/requests/model";

const useBootstrapQueryMock = vi.fn();
const useCustomerRequestPendingSummaryQueryMock = vi.fn();
const useSpecialRequestCountQueryMock = vi.fn();
const useOrderCountQueryMock = vi.fn();
const bootstrapRefetchMock = vi.fn();
const requestsRefetchMock = vi.fn();
const specialRequestCountRefetchMock = vi.fn();
const orderCountRefetchMock = vi.fn();

vi.mock("@/features/bootstrap/queries", () => ({
  useBootstrapQuery: () => useBootstrapQueryMock(),
}));
vi.mock("@/features/requests/queries", () => ({
  useCustomerRequestPendingSummaryQuery: () => useCustomerRequestPendingSummaryQueryMock(),
}));
vi.mock("@/features/special-requests/queries", () => ({
  useSpecialRequestCountQuery: () => useSpecialRequestCountQueryMock(),
}));
vi.mock("@/features/orders/queries", () => ({
  useOrderCountQuery: () => useOrderCountQueryMock(),
}));
const useExpenseSummaryQueryMock = vi.fn();
const useInventorySummaryQueryMock = vi.fn();
vi.mock("@/features/expenses/queries", () => ({
  useExpenseSummaryQuery: (month: string) => useExpenseSummaryQueryMock(month),
}));
vi.mock("./queries", () => ({
  useInventorySummaryQuery: () => useInventorySummaryQueryMock(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { DashboardPage } from "./DashboardPage";

// Non-empty fixture: one pending general request, one menu item, one notice
// — enough for every card to show a non-zero count, so this fixture must
// never be mistaken for the empty state.
const NON_EMPTY_APP_DATA: AppData = {
  store: {
    name: "LAM",
    subtitle: "",
    address: "",
    songRequestCopy: "",
    requestCopy: "",
    eventCopy: "",
  },
  categories: [],
  items: [{ id: "m1", categoryId: "c1", name: "모히토", description: "", price: "10000", isVisible: true }],
  requestGuides: [],
  notices: [{ id: "n1", text: "이벤트 안내", isVisible: true }],
};

const NON_EMPTY_REQUESTS: CustomerRequestPendingSummary = {
  pendingGeneralCount: 1,
  pendingSongCount: 0,
  items: [
    {
      id: "r1",
      tableNumber: "1",
      text: "물 좀 주세요",
      status: "pending",
      createdAt: "2026-09-03T10:00:00Z",
    },
  ],
};

const EMPTY_REQUESTS: CustomerRequestPendingSummary = {
  pendingGeneralCount: 0,
  pendingSongCount: 0,
  items: [],
};

const EMPTY_APP_DATA: AppData = {
  ...NON_EMPTY_APP_DATA,
  items: [],
  notices: [],
};

const NON_EMPTY_ORDER_COUNT: OrderPageResult = { items: [], page: 1, pageSize: 1, total: 1 };
const EMPTY_ORDER_COUNT: OrderPageResult = { items: [], page: 1, pageSize: 1, total: 0 };

const NON_EMPTY_SPECIAL_REQUEST_COUNT = { total: 1 };
const EMPTY_SPECIAL_REQUEST_COUNT = { total: 0 };

function mockBootstrap(overrides: Partial<ReturnType<typeof defaultBootstrapResult>> = {}) {
  useBootstrapQueryMock.mockReturnValue({ ...defaultBootstrapResult(), ...overrides });
}

function defaultBootstrapResult() {
  return {
    data: NON_EMPTY_APP_DATA,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: bootstrapRefetchMock,
  };
}

function mockRequests(overrides: Partial<ReturnType<typeof defaultRequestsResult>> = {}) {
  useCustomerRequestPendingSummaryQueryMock.mockReturnValue({ ...defaultRequestsResult(), ...overrides });
}

function defaultRequestsResult() {
  return {
    data: NON_EMPTY_REQUESTS,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: requestsRefetchMock,
  };
}

function mockSpecialRequestCount(
  overrides: Partial<ReturnType<typeof defaultSpecialRequestCountResult>> = {},
) {
  useSpecialRequestCountQueryMock.mockReturnValue({
    ...defaultSpecialRequestCountResult(),
    ...overrides,
  });
}

function defaultSpecialRequestCountResult() {
  return {
    data: NON_EMPTY_SPECIAL_REQUEST_COUNT,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: specialRequestCountRefetchMock,
  };
}

function mockOrderCount(overrides: Partial<ReturnType<typeof defaultOrderCountResult>> = {}) {
  useOrderCountQueryMock.mockReturnValue({ ...defaultOrderCountResult(), ...overrides });
}

function defaultOrderCountResult() {
  return {
    data: NON_EMPTY_ORDER_COUNT,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: orderCountRefetchMock,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    bootstrapRefetchMock.mockClear();
    requestsRefetchMock.mockClear();
    specialRequestCountRefetchMock.mockClear();
    orderCountRefetchMock.mockClear();
    mockBootstrap();
    mockRequests();
    mockSpecialRequestCount();
    mockOrderCount();
    useExpenseSummaryQueryMock.mockReturnValue({
      data: {
        month: "2026-09",
        total: 368000,
        previousMonthTotal: 500000,
        receiptCount: 4,
        byCategory: [],
      },
      isLoading: false,
      isError: false,
    });
    useInventorySummaryQueryMock.mockReturnValue({
      data: { reorderCount: 2, needsCheckCount: 0 },
      isLoading: false,
      isError: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state while any of the four queries is loading", () => {
    mockBootstrap({ data: undefined, isLoading: true });

    render(<DashboardPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows a loading state while the order count query is loading", () => {
    mockOrderCount({ data: undefined, isLoading: true });

    render(<DashboardPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state and retries only the failed query", () => {
    mockRequests({ data: undefined, isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<DashboardPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(requestsRefetchMock).toHaveBeenCalledTimes(1);
    expect(bootstrapRefetchMock).not.toHaveBeenCalled();
    expect(specialRequestCountRefetchMock).not.toHaveBeenCalled();
    expect(orderCountRefetchMock).not.toHaveBeenCalled();
  });

  it("shows the empty state when every aggregate count is genuinely zero", () => {
    mockBootstrap({ data: EMPTY_APP_DATA });
    mockRequests({ data: EMPTY_REQUESTS });
    mockSpecialRequestCount({ data: EMPTY_SPECIAL_REQUEST_COUNT });
    mockOrderCount({ data: EMPTY_ORDER_COUNT });

    render(<DashboardPage />);

    expect(screen.getByText("표시할 데이터가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("손님 요청")).not.toBeInTheDocument();
  });

  it("renders the shortcut cards with their counts when at least one count is non-zero", () => {
    render(<DashboardPage />);

    expect(screen.getByText("손님 요청")).toBeInTheDocument();
    expect(screen.queryByText("표시할 데이터가 없습니다.")).not.toBeInTheDocument();
    // 1 pending general request, 0 pending song requests, 1 special request,
    // 1 order, 1 menu item, 1 notice — matches the non-empty fixtures above.
    expect(screen.getAllByText("1")).toHaveLength(5);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("adds this month's spending and the reorder count as shortcut cards", () => {
    render(<DashboardPage />);

    expect(useExpenseSummaryQueryMock).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/));
    const expenses = screen.getByRole("link", { name: /이번 달 지출/ });
    expect(expenses).toHaveAttribute("href", "/expenses");
    expect(expenses).toHaveTextContent("368,000원");
    const reorder = screen.getByRole("link", { name: /주문 필요 품목/ });
    expect(reorder).toHaveAttribute("href", "/inventory");
    expect(reorder).toHaveTextContent("2");
  });

  it("keeps the rest of the dashboard when the expense or inventory summary fails", () => {
    useExpenseSummaryQueryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    useInventorySummaryQueryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    render(<DashboardPage />);

    expect(screen.getByText("손님 요청")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /이번 달 지출/ })).toHaveTextContent("불러오지 못했어요");
    expect(screen.getByRole("link", { name: /주문 필요 품목/ })).toHaveTextContent("불러오지 못했어요");
  });
});
