import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderListQuery, OrderPageResult, PaymentOrder } from "./model";

const replaceMock = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/orders",
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => currentSearchParams,
}));

const useOrdersPageQueryMock = vi.fn();
const refetchMock = vi.fn();
const useAcknowledgeOrderMutationMock = vi.fn();
const acknowledgeMutateMock = vi.fn();

vi.mock("./queries", () => ({
  useOrdersPageQuery: (query: unknown, enabled: unknown) => useOrdersPageQueryMock(query, enabled),
  useAcknowledgeOrderMutation: () => useAcknowledgeOrderMutationMock(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, fetchOrdersPage: vi.fn() };
});

import { fetchOrdersPage } from "./api";
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
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    error: null as unknown,
    refetch: refetchMock,
  };
}

// A populated date range so the screen renders its data view instead of
// the "resolving the default range" loading state (see `OrderListPage`'s
// mount effect / `dateFrom`/`dateTo` handling).
const DATED_SEARCH_PARAMS = new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-10");

/**
 * Renders against a real `QueryClient` so a test can drive the actual
 * `useOrdersPageQuery` rather than a hand-written result object. That
 * hand-written shape can only model a *same-key* refetch failure, where
 * React Query keeps `data`; it cannot reproduce a *new-key* failure, where
 * `keepPreviousData` lets go of the previous page entirely — which is the
 * case this screen was getting wrong.
 */
function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

/**
 * Points the module mock at the real hook for the rest of the current test.
 * `beforeEach`'s `mockQuery()` puts the plain return value back, so this
 * never leaks into the tests that want a hand-written result.
 */
async function useTheRealOrdersPageQuery() {
  const actual = await vi.importActual<typeof import("./queries")>("./queries");
  function useRealOrdersPageQuery(listQuery: OrderListQuery, enabled: boolean) {
    return actual.useOrdersPageQuery(listQuery, enabled);
  }
  useOrdersPageQueryMock.mockImplementation(useRealOrdersPageQuery);
}

describe("OrderListPage", () => {
  beforeEach(() => {
    refetchMock.mockClear();
    replaceMock.mockClear();
    useOrdersPageQueryMock.mockClear();
    useAcknowledgeOrderMutationMock.mockClear();
    acknowledgeMutateMock.mockClear();
    useAcknowledgeOrderMutationMock.mockReturnValue({
      mutate: acknowledgeMutateMock,
      isPending: false,
      variables: undefined,
    });
    currentSearchParams = new URLSearchParams(DATED_SEARCH_PARAMS);
    vi.mocked(fetchOrdersPage).mockReset();
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

  // First load has no rows to preserve, but it must render as a skeleton
  // table (matching the real table's header/row structure) instead of a
  // centered spinner, so the layout doesn't jump once data arrives.
  it("shows a skeleton table, not a centered spinner, on first load", () => {
    mockQuery({ data: undefined, isLoading: true });

    render(<OrderListPage />);

    const status = screen.getByRole("status");
    expect(status.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(within(status).getByRole("table")).toBeInTheDocument();
  });

  // Once the operator already has a page of orders on screen, a refetch
  // failure (e.g. a flaky network blip) must not tear the table down —
  // the rows they were reading stay, with an inline error and retry.
  it("keeps the rows visible and shows an inline error when a refetch fails after data was already loaded", () => {
    mockQuery({ isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<OrderListPage />);

    expect(screen.getByText("Beer")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  // Paging must not tear the screen down. Before this, the page-level
  // `isLoading` gate swapped the whole list (toolbar, table, pagination) for
  // a centred spinner on every page click: the document collapsed to a
  // fraction of its height, the scrollbar appeared and disappeared, and the
  // button that was just clicked unmounted under the pointer. The next page
  // now arrives under a progress bar with the previous rows still in place.
  it("keeps the rows and the pagination mounted while the next page loads", () => {
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<OrderListPage />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Beer")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "페이지 탐색" })).toBeInTheDocument();
  });

  // The bar waits out `ListUpdatingRegion`'s show delay on purpose, so a page
  // that resolves from cache or in a few ms never flashes 2px of chrome.
  it("raises the progress bar once the show delay has passed", () => {
    vi.useFakeTimers();
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<OrderListPage />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole("progressbar", { name: "목록을 업데이트하는 중" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("marks the list busy while it is showing a stale page", () => {
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<OrderListPage />);

    expect(screen.getByRole("table").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
  });

  // App Router scrolls the document to the top on every navigation by
  // default, which yanked the operator away from the list they had just
  // clicked in. Paging must leave the viewport where it is.
  it("changes the page without scrolling the document to the top", () => {
    mockQuery({ data: pageFixture(ORDERS, { page: 1, total: 45 }) });

    render(<OrderListPage />);
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining("page=2"), { scroll: false });
  });

  it("leaves the list idle and unmarked once the page has settled", () => {
    render(<OrderListPage />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("table").closest("[aria-busy]")).toHaveAttribute("aria-busy", "false");
  });

  it("shows an error state with a working retry action when the query fails", () => {
    mockQuery({ data: undefined, isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<OrderListPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  // The defect these three tests exist for: `placeholderData` only holds the
  // previous entry while the new key is *pending*, and lets go the moment
  // that request fails. An operator reading page 1 who clicked to page 2
  // used to lose the entire list to a full-screen error.
  it("keeps the previous page's rows, with an inline error and retry, when a new page's request fails", async () => {
    await useTheRealOrdersPageQuery();
    vi.mocked(fetchOrdersPage).mockImplementation(async (listQuery) => {
      if (listQuery.page === 1) return pageFixture(ORDERS, { page: 1, pageSize: 20, total: 45 });
      throw new Error("요청이 실패했습니다. (500)");
    });

    const { rerender } = renderWithQueryClient(<OrderListPage />);
    expect(await screen.findByText("Beer")).toBeInTheDocument();

    currentSearchParams = new URLSearchParams(`${DATED_SEARCH_PARAMS}&page=2`);
    rerender(<OrderListPage />);

    expect(
      await screen.findByText("요청이 실패해 이전에 불러온 목록을 그대로 보여주고 있습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("Beer")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  // The rows on screen are page 1's, so the pagination and the total must
  // say page 1 — the URL asked for page 2, but page 2 never arrived.
  it("keeps the pagination on the page the retained rows actually came from", async () => {
    await useTheRealOrdersPageQuery();
    vi.mocked(fetchOrdersPage).mockImplementation(async (listQuery) => {
      if (listQuery.page === 1) return pageFixture(ORDERS, { page: 1, pageSize: 20, total: 45 });
      throw new Error("요청이 실패했습니다. (500)");
    });

    const { rerender } = renderWithQueryClient(<OrderListPage />);
    expect(await screen.findByText("Beer")).toBeInTheDocument();

    currentSearchParams = new URLSearchParams(`${DATED_SEARCH_PARAMS}&page=2`);
    rerender(<OrderListPage />);
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "1페이지" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("총 45건")).toBeInTheDocument();
  });

  // Nothing ever succeeded, so there are no rows to preserve and the screen
  // is free to replace itself entirely.
  it("still replaces the whole screen with an error state when the very first load fails", async () => {
    await useTheRealOrdersPageQuery();
    vi.mocked(fetchOrdersPage).mockRejectedValue(new Error("요청이 실패했습니다. (500)"));

    renderWithQueryClient(<OrderListPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("주문 내역을 불러오지 못했습니다.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
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

  it("adds an action column and acknowledges a READY order from its row", () => {
    render(<OrderListPage />);

    expect(screen.getByRole("columnheader", { name: "작업" })).toBeInTheDocument();
    const readyRow = screen.getByRole("link", { name: "Cider" }).closest("tr");
    fireEvent.click(within(readyRow as HTMLElement).getByRole("button", { name: "주문확인" }));

    expect(acknowledgeMutateMock).toHaveBeenCalledWith("order-2");
    expect(screen.getAllByRole("button", { name: "주문확인" })).toHaveLength(1);
  });

  it("disables only the order being acknowledged", () => {
    useAcknowledgeOrderMutationMock.mockReturnValue({
      mutate: acknowledgeMutateMock,
      isPending: true,
      variables: "order-2",
    });

    render(<OrderListPage />);

    expect(screen.getByRole("button", { name: "주문확인" })).toBeDisabled();
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
