import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CustomerRequest,
  CustomerRequestListQuery,
  CustomerRequestPageResult,
} from "./model";

const replaceMock = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/requests",
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => currentSearchParams,
}));

const useCustomerRequestsPageQueryMock = vi.fn();
const useUpdateCustomerRequestStatusMutationMock = vi.fn();
const useApproveSongRequestMutationMock = vi.fn();
const mutateMock = vi.fn();
const approveMutateMock = vi.fn();
const refetchMock = vi.fn();

vi.mock("./queries", () => ({
  useCustomerRequestsPageQuery: (query: unknown, enabled: unknown) =>
    useCustomerRequestsPageQueryMock(query, enabled),
  useUpdateCustomerRequestStatusMutation: () => useUpdateCustomerRequestStatusMutationMock(),
  useApproveSongRequestMutation: () => useApproveSongRequestMutationMock(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, fetchCustomerRequestsPage: vi.fn() };
});

import { fetchCustomerRequestsPage } from "./api";
import { RequestListPage } from "./RequestListPage";

const ITEMS: CustomerRequest[] = [
  {
    id: "r1",
    tableNumber: "1",
    text: "물 좀 주세요",
    status: "pending",
    createdAt: "2026-09-03T10:00:00Z",
  },
  {
    id: "r2",
    tableNumber: "2",
    text: "check please",
    status: "checked",
    createdAt: "2026-09-03T10:05:00Z",
  },
];

const SONG_ITEMS: CustomerRequest[] = [
  {
    id: "r3",
    tableNumber: "3",
    text: "[노래 신청] Dynamite - BTS",
    status: "pending",
    createdAt: "2026-09-03T10:10:00Z",
  },
];

function pageFixture(items: CustomerRequest[], overrides: Partial<CustomerRequestPageResult> = {}): CustomerRequestPageResult {
  return { items, page: 1, pageSize: 20, total: items.length, ...overrides };
}

// A populated date range so the screen renders its data view instead of
// the "resolving the default range" loading state (see `RequestListPage`'s
// mount effect / `dateFrom`/`dateTo` handling).
const DATED_SEARCH_PARAMS = "dateFrom=2026-01-01&dateTo=2026-01-10";

/**
 * Renders against a real `QueryClient` so a test can drive the actual
 * `useCustomerRequestsPageQuery` rather than a hand-written result object.
 * That hand-written shape can only model a *same-key* refetch failure, where
 * React Query keeps `data`; it cannot reproduce a *new-key* failure, where
 * `keepPreviousData` lets go of the previous page entirely.
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
async function useTheRealRequestsPageQuery() {
  const actual = await vi.importActual<typeof import("./queries")>("./queries");
  function useRealCustomerRequestsPageQuery(
    listQuery: CustomerRequestListQuery,
    enabled: boolean,
  ) {
    return actual.useCustomerRequestsPageQuery(listQuery, enabled);
  }
  useCustomerRequestsPageQueryMock.mockImplementation(useRealCustomerRequestsPageQuery);
}

function mockQuery(overrides: Partial<ReturnType<typeof defaultQueryResult>> = {}) {
  useCustomerRequestsPageQueryMock.mockReturnValue({ ...defaultQueryResult(), ...overrides });
}

function defaultQueryResult() {
  return {
    data: pageFixture(ITEMS),
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    error: null as unknown,
    refetch: refetchMock,
  };
}

function mockMutation(overrides: Partial<ReturnType<typeof defaultMutationResult>> = {}) {
  useUpdateCustomerRequestStatusMutationMock.mockReturnValue({
    ...defaultMutationResult(),
    ...overrides,
  });
}

function defaultMutationResult() {
  return {
    mutate: mutateMock,
    isPending: false,
    isError: false,
    error: null as unknown,
    variables: undefined as { id: string; status: string } | undefined,
  };
}

describe("RequestListPage", () => {
  beforeEach(() => {
    mutateMock.mockClear();
    refetchMock.mockClear();
    replaceMock.mockClear();
    useCustomerRequestsPageQueryMock.mockClear();
    approveMutateMock.mockClear();
    currentSearchParams = new URLSearchParams(DATED_SEARCH_PARAMS);
    vi.mocked(fetchCustomerRequestsPage).mockReset();
    mockQuery();
    mockMutation();
    useApproveSongRequestMutationMock.mockReturnValue({
      mutate: approveMutateMock,
      isPending: false,
      isError: false,
      error: null,
      variables: undefined,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state while the request page is loading", () => {
    mockQuery({ data: undefined, isLoading: true });

    render(<RequestListPage kind="general" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // First load has no rows to preserve, but it must render as a skeleton
  // table (matching the real table's header/row structure) instead of a
  // centered spinner, so the layout doesn't jump once data arrives.
  it("shows a skeleton table, not a centered spinner, on first load", () => {
    mockQuery({ data: undefined, isLoading: true });

    render(<RequestListPage kind="general" />);

    const status = screen.getByRole("status");
    expect(status.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(within(status).getByRole("table")).toBeInTheDocument();
  });

  // Once the operator already has a page of requests on screen, a refetch
  // failure must not tear the table down — the rows they were reading stay,
  // with an inline error and retry.
  it("keeps the rows visible and shows an inline error when a refetch fails after data was already loaded", () => {
    mockQuery({ isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<RequestListPage kind="general" />);

    expect(screen.getByText("물 좀 주세요")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  // See `features/orders/OrderListPage.test.tsx` for why paging must not
  // unmount the list: the page-level `isLoading` gate used to replace the
  // whole screen with a spinner on every page click.
  it("keeps the rows and the pagination mounted while the next page loads", () => {
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<RequestListPage kind="general" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("물 좀 주세요")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "페이지 탐색" })).toBeInTheDocument();
  });

  // The bar waits out `ListUpdatingRegion`'s show delay on purpose — see the
  // equivalent test in `features/orders/OrderListPage.test.tsx`.
  it("raises the progress bar once the show delay has passed", () => {
    vi.useFakeTimers();
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<RequestListPage kind="general" />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole("progressbar", { name: "목록을 업데이트하는 중" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("marks the list busy while it is showing a stale page", () => {
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<RequestListPage kind="general" />);

    expect(screen.getByRole("table").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
  });

  it("shows an error state with a working retry action when the query fails", () => {
    mockQuery({
      data: undefined,
      isError: true,
      error: new Error("요청이 실패했습니다. (500)"),
    });

    render(<RequestListPage kind="general" />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  // The defect these three tests exist for: `placeholderData` only holds the
  // previous entry while the new key is *pending*, and lets go the moment
  // that request fails, so a failed page click used to replace the whole
  // list with an error.
  it("keeps the previous page's rows, with an inline error and retry, when a new page's request fails", async () => {
    await useTheRealRequestsPageQuery();
    vi.mocked(fetchCustomerRequestsPage).mockImplementation(async (listQuery) => {
      if (listQuery.page === 1) return pageFixture(ITEMS, { page: 1, pageSize: 20, total: 45 });
      throw new Error("요청이 실패했습니다. (500)");
    });

    const { rerender } = renderWithQueryClient(<RequestListPage kind="general" />);
    expect(await screen.findByText("물 좀 주세요")).toBeInTheDocument();

    currentSearchParams = new URLSearchParams(`${DATED_SEARCH_PARAMS}&page=2`);
    rerender(<RequestListPage kind="general" />);

    expect(
      await screen.findByText("요청이 실패해 이전에 불러온 목록을 그대로 보여주고 있습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("물 좀 주세요")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  // The rows on screen are page 1's, so the pagination and the total must
  // say page 1 — the URL asked for page 2, but page 2 never arrived.
  it("keeps the pagination on the page the retained rows actually came from", async () => {
    await useTheRealRequestsPageQuery();
    vi.mocked(fetchCustomerRequestsPage).mockImplementation(async (listQuery) => {
      if (listQuery.page === 1) return pageFixture(ITEMS, { page: 1, pageSize: 20, total: 45 });
      throw new Error("요청이 실패했습니다. (500)");
    });

    const { rerender } = renderWithQueryClient(<RequestListPage kind="general" />);
    expect(await screen.findByText("물 좀 주세요")).toBeInTheDocument();

    currentSearchParams = new URLSearchParams(`${DATED_SEARCH_PARAMS}&page=2`);
    rerender(<RequestListPage kind="general" />);
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "1페이지" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("총 45건")).toBeInTheDocument();
  });

  // Nothing ever succeeded, so there are no rows to preserve and the screen
  // is free to replace itself entirely.
  it("still replaces the whole screen with an error state when the very first load fails", async () => {
    await useTheRealRequestsPageQuery();
    vi.mocked(fetchCustomerRequestsPage).mockRejectedValue(new Error("요청이 실패했습니다. (500)"));

    renderWithQueryClient(<RequestListPage kind="general" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("요청 목록을 불러오지 못했습니다.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows translated labels (not the raw value) in the status and sort selects", () => {
    render(<RequestListPage kind="general" />);

    // Base UI's <Select.Value> renders the raw string value unless given a
    // label mapping — a prior version of this page showed literal "all"/
    // "status" here instead of "전체"/"상태순". Locks the fix in place.
    expect(screen.getByText("전체")).toBeInTheDocument();
    expect(screen.getByText("상태순")).toBeInTheDocument();
    expect(screen.queryByText("all", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.queryByText("status", { selector: "span" })).not.toBeInTheDocument();
  });

  it("keeps the total count out of the title row", () => {
    render(<RequestListPage kind="general" />);

    const heading = screen.getByRole("heading", { name: "손님 요청" });
    expect(within(heading.parentElement as HTMLElement).queryByText("총 2건")).not.toBeInTheDocument();
    expect(screen.getByText("총 2건")).toBeInTheDocument();
  });

  it("requests kind=general for the general screen and kind=song for the song screen", () => {
    render(<RequestListPage kind="general" />);
    expect(useCustomerRequestsPageQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "general" }),
      true,
    );

    cleanup();
    render(<RequestListPage kind="song" />);
    expect(useCustomerRequestsPageQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "song" }),
      true,
    );
  });

  it("shows the original empty state when the result is empty with no active filter", () => {
    mockQuery({ data: pageFixture([], { total: 0 }) });

    render(<RequestListPage kind="general" />);

    expect(screen.getByText("대기 중인 손님 요청이 없습니다.")).toBeInTheDocument();
  });

  it("shows a distinct 'no results' state when a filter/search yields nothing", () => {
    currentSearchParams = new URLSearchParams(`${DATED_SEARCH_PARAMS}&q=nomatch`);
    mockQuery({ data: pageFixture([], { total: 0 }) });

    render(<RequestListPage kind="general" />);

    expect(screen.getByText("검색 결과가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("대기 중인 손님 요청이 없습니다.")).not.toBeInTheDocument();
  });

  it("renders rows from the server response, stripping the song-request prefix for display", () => {
    currentSearchParams = new URLSearchParams(`${DATED_SEARCH_PARAMS}&sort=createdAt&order=desc`);
    mockQuery({ data: pageFixture(SONG_ITEMS) });

    render(<RequestListPage kind="song" />);

    expect(screen.getByText("Dynamite - BTS")).toBeInTheDocument();
    expect(screen.queryByText("[노래 신청] Dynamite - BTS")).not.toBeInTheDocument();
  });

  it("advances a pending request to checked when its action button is clicked", () => {
    render(<RequestListPage kind="general" />);

    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(mutateMock).toHaveBeenCalledWith({ id: "r1", status: "checked" });
  });

  it("approves a pending song into the playback queue instead of merely checking it", () => {
    mockQuery({ data: pageFixture(SONG_ITEMS) });

    render(<RequestListPage kind="song" />);

    fireEvent.click(screen.getByRole("button", { name: "승인 및 재생" }));
    expect(approveMutateMock).toHaveBeenCalledWith({ requestId: "r3" });
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("shows an approved song as queued without a manual completion action", () => {
    mockQuery({ data: pageFixture([{ ...SONG_ITEMS[0], status: "checked" }]) });

    render(<RequestListPage kind="song" />);

    expect(screen.getByText("재생 대기")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "처리완료" })).not.toBeInTheDocument();
  });

  it("explains that the server key is missing when song approval is unavailable", () => {
    mockQuery({ data: pageFixture(SONG_ITEMS) });
    useApproveSongRequestMutationMock.mockReturnValue({
      mutate: approveMutateMock,
      isPending: false,
      isError: true,
      error: Object.assign(new Error("youtube search is not configured"), { status: 503 }),
      variables: undefined,
    });

    render(<RequestListPage kind="song" />);

    expect(screen.getByRole("alert")).toHaveTextContent("YouTube API 키가 설정되지 않았습니다.");
  });

  it("advances a checked request to completed when its action button is clicked", () => {
    render(<RequestListPage kind="general" />);

    fireEvent.click(screen.getByRole("button", { name: "처리완료" }));

    expect(mutateMock).toHaveBeenCalledWith({ id: "r2", status: "completed" });
  });

  it("disables only the row whose own mutation is in flight, preventing duplicate submission", () => {
    mockMutation({ isPending: true, variables: { id: "r1", status: "checked" } });

    render(<RequestListPage kind="general" />);

    const buttons = screen.getAllByRole("button", { name: "확인" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeDisabled();
  });

  it("navigates to the next page via Pagination, keeping the other query params", () => {
    currentSearchParams = new URLSearchParams(`${DATED_SEARCH_PARAMS}&status=pending`);
    mockQuery({ data: pageFixture(ITEMS, { page: 1, total: 45 }) });

    render(<RequestListPage kind="general" />);

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    // `scroll: false` is part of the contract, not incidental: App Router
    // scrolls the document to the top on every navigation by default, which
    // yanked the operator away from the list they had just clicked in.
    expect(replaceMock).toHaveBeenCalledWith(
      "/requests?page=2&status=pending&dateFrom=2026-01-01&dateTo=2026-01-10",
      { scroll: false },
    );
  });

  it("debounces a typed search into the URL and resets to page 1", async () => {
    vi.useFakeTimers();
    currentSearchParams = new URLSearchParams(`${DATED_SEARCH_PARAMS}&page=3`);
    mockQuery({ data: pageFixture(ITEMS, { page: 3, total: 45 }) });

    render(<RequestListPage kind="general" />);

    fireEvent.change(screen.getByPlaceholderText("테이블 번호, 내용으로 검색"), {
      target: { value: "napkin" },
    });

    expect(replaceMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replaceMock).toHaveBeenCalledWith(
      "/requests?q=napkin&dateFrom=2026-01-01&dateTo=2026-01-10",
      { scroll: false },
    );
    vi.useRealTimers();
  });

  it("renders the from/to date inputs seeded from the URL", () => {
    render(<RequestListPage kind="general" />);

    expect(screen.getByLabelText("시작일")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("종료일")).toHaveValue("2026-01-10");
  });

  it("shows a loading state and seeds a default 7-day range when the URL has no date bound", () => {
    currentSearchParams = new URLSearchParams();
    mockQuery({ data: undefined, isLoading: true });

    render(<RequestListPage kind="general" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = replaceMock.mock.calls[0] as [string];
    expect(calledUrl).toMatch(/^\/requests\?dateFrom=\d{4}-\d{2}-\d{2}&dateTo=\d{4}-\d{2}-\d{2}$/);
  });
});
