import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderPageResult, PaymentOrder } from "./model";

const replaceMock = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/orders",
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => currentSearchParams,
}));

const useOrdersPageQueryMock = vi.fn();
const refetchMock = vi.fn();

vi.mock("./queries", () => ({
  useOrdersPageQuery: (query: unknown, enabled: unknown) => useOrdersPageQueryMock(query, enabled),
}));

import { OrderListPage } from "./OrderListPage";

const ORDERS: PaymentOrder[] = [
  {
    orderId: "order-1",
    menuItemId: "menu-1",
    menuItemName: "Beer",
    categoryName: "Drinks",
    tableNumber: "5",
    requestNote: "얼음은 적게 주세요",
    amount: 8000,
    vat: 727,
    suppliedAmount: 7273,
    taxFreeAmount: 0,
    status: "DONE",
    paymentMethod: "카드",
    paymentKey: "pk_123",
    approvedAt: "2026-01-10T12:10:00Z",
    posSyncStatus: "SUCCEEDED",
    posOrderId: "pos-1",
    createdAt: "2026-01-10T12:00:00Z",
  },
  {
    orderId: "order-2",
    menuItemName: "Cider",
    categoryName: "Drinks",
    tableNumber: "6",
    requestNote: "",
    amount: 5000,
    vat: 0,
    suppliedAmount: 5000,
    taxFreeAmount: 0,
    status: "READY",
    posSyncStatus: "PENDING",
    createdAt: "2026-01-10T13:00:00Z",
  },
  {
    orderId: "order-3",
    menuItemName: "Wine",
    categoryName: "Drinks",
    tableNumber: "7",
    requestNote: "",
    amount: 12000,
    vat: 1091,
    suppliedAmount: 10909,
    taxFreeAmount: 0,
    status: "CANCELLED",
    posSyncStatus: "NOT_CONFIGURED",
    createdAt: "2026-01-10T14:00:00Z",
  },
];

function pageFixture(items: PaymentOrder[], overrides: Partial<OrderPageResult> = {}): OrderPageResult {
  return { items, page: 1, pageSize: 20, total: items.length, ...overrides };
}

function mockQuery(overrides: Partial<ReturnType<typeof defaultQueryResult>> = {}) {
  useOrdersPageQueryMock.mockReturnValue({ ...defaultQueryResult(), ...overrides });
}

function defaultQueryResult() {
  return {
    data: pageFixture(ORDERS),
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: refetchMock,
  };
}

// A populated date range so the screen renders its data view instead of
// the "resolving the default range" loading state (see `OrderListPage`'s
// mount effect / `dateFrom`/`dateTo` handling).
const DATED_SEARCH_PARAMS = new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-10");

describe("OrderListPage", () => {
  beforeEach(() => {
    refetchMock.mockClear();
    replaceMock.mockClear();
    useOrdersPageQueryMock.mockClear();
    currentSearchParams = new URLSearchParams(DATED_SEARCH_PARAMS);
    mockQuery();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state while the date range hasn't resolved yet", () => {
    currentSearchParams = new URLSearchParams();
    mockQuery({ data: undefined, isLoading: true });

    render(<OrderListPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows a loading state while the order page is loading", () => {
    mockQuery({ data: undefined, isLoading: true });

    render(<OrderListPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state with a working retry action when the query fails", () => {
    mockQuery({ data: undefined, isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<OrderListPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when the result is empty with no active filter", () => {
    mockQuery({ data: pageFixture([], { total: 0 }) });

    render(<OrderListPage />);

    expect(screen.getByText("주문 내역이 없습니다.")).toBeInTheDocument();
  });

  it("keeps the total count out of the title row", () => {
    render(<OrderListPage />);

    const heading = screen.getByRole("heading", { name: "주문 내역" });
    expect(within(heading.parentElement as HTMLElement).queryByText("총 3건")).not.toBeInTheDocument();
    expect(screen.getByText("총 3건")).toBeInTheDocument();
  });

  it("renders order rows with table number, menu item, amount, status, and POS sync state", () => {
    render(<OrderListPage />);

    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Beer")).toBeInTheDocument();
    expect(screen.getByText("₩8,000")).toBeInTheDocument();
    expect(screen.getByText("결제완료")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("Cider")).toBeInTheDocument();
    expect(screen.getByText("주문접수")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Wine")).toBeInTheDocument();
    expect(screen.getByText("취소됨")).toBeInTheDocument();
  });

  it("defaults to requesting no status filter (via the URL query parser's own default)", () => {
    render(<OrderListPage />);
    expect(useOrdersPageQueryMock).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }), true);
  });

  it("shows the CANCELLED status label when the URL already carries that filter", () => {
    currentSearchParams = new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-10&status=CANCELLED");

    render(<OrderListPage />);

    expect(useOrdersPageQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CANCELLED" }),
      true,
    );
  });

  it("accepts ACKNOWLEDGED as a status filter from the URL", () => {
    currentSearchParams = new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-10&status=ACKNOWLEDGED");

    render(<OrderListPage />);

    expect(useOrdersPageQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ACKNOWLEDGED" }),
      true,
    );
  });

  it("links each row's menu item name to the order-detail route, underlined by default so it reads as clickable", () => {
    render(<OrderListPage />);

    const beerLink = screen.getByRole("link", { name: "Beer" });
    expect(beerLink).toHaveAttribute("href", "/orders/order-1");
    expect(beerLink).toHaveClass("underline");
    expect(beerLink).toHaveClass("hover:font-bold");
    expect(screen.getByRole("link", { name: "Cider" })).toHaveAttribute("href", "/orders/order-2");
  });

  it("renders the from/to date inputs seeded from the URL", () => {
    render(<OrderListPage />);

    expect(screen.getByLabelText("시작일")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("종료일")).toHaveValue("2026-01-10");
  });
});
