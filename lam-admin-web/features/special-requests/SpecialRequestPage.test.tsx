import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SpecialRequest,
  SpecialRequestListQuery,
  SpecialRequestPageResult,
} from "./model";

const useSpecialRequestsPageQueryMock = vi.fn();
const useDeleteSpecialRequestMutationMock = vi.fn();
const mutateMock = vi.fn();
const refetchMock = vi.fn();

vi.mock("./queries", () => ({
  useSpecialRequestsPageQuery: (query: unknown, enabled: unknown) =>
    useSpecialRequestsPageQueryMock(query, enabled),
  useDeleteSpecialRequestMutation: () => useDeleteSpecialRequestMutationMock(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, fetchSpecialRequestsPage: vi.fn() };
});

import { fetchSpecialRequestsPage } from "./api";
import { SpecialRequestPage } from "./SpecialRequestPage";

const ITEMS: SpecialRequest[] = [
  {
    id: "s1",
    tableNumber: "5",
    gender: "female",
    name: "홍길동",
    age: "20대",
    residence: "서울",
    instagram: "@handle",
    idealType: "친절한 사람",
    text: "소개해주세요",
    createdAt: "2026-09-03T10:00:00Z",
  },
];

function pageFixture(
  items: SpecialRequest[],
  overrides: Partial<SpecialRequestPageResult> = {},
): SpecialRequestPageResult {
  return { items, page: 1, pageSize: 20, total: items.length, ...overrides };
}

function mockQuery(overrides: Partial<ReturnType<typeof defaultQueryResult>> = {}) {
  useSpecialRequestsPageQueryMock.mockReturnValue({ ...defaultQueryResult(), ...overrides });
}

/**
 * Renders against a real `QueryClient` so a test can drive the actual
 * `useSpecialRequestsPageQuery` rather than a hand-written result object.
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
async function useTheRealSpecialRequestsPageQuery() {
  const actual = await vi.importActual<typeof import("./queries")>("./queries");
  function useRealSpecialRequestsPageQuery(listQuery: SpecialRequestListQuery, enabled: boolean) {
    return actual.useSpecialRequestsPageQuery(listQuery, enabled);
  }
  useSpecialRequestsPageQueryMock.mockImplementation(useRealSpecialRequestsPageQuery);
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
  useDeleteSpecialRequestMutationMock.mockReturnValue({
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
    variables: undefined as string | undefined,
  };
}

describe("SpecialRequestPage", () => {
  beforeEach(() => {
    mutateMock.mockClear();
    refetchMock.mockClear();
    useSpecialRequestsPageQueryMock.mockClear();
    vi.mocked(fetchSpecialRequestsPage).mockReset();
    mockQuery();
    mockMutation();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state while the special request page is loading", () => {
    mockQuery({ data: undefined, isLoading: true });

    render(<SpecialRequestPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // First load has no rows to preserve, but it must render as a skeleton
  // table (matching the real table's header/row structure) instead of a
  // centered spinner, so the layout doesn't jump once data arrives.
  it("shows a skeleton table, not a centered spinner, on first load", () => {
    mockQuery({ data: undefined, isLoading: true });

    render(<SpecialRequestPage />);

    const status = screen.getByRole("status");
    expect(status.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(within(status).getByRole("table")).toBeInTheDocument();
  });

  // Once the operator already has a page of special requests on screen, a
  // refetch failure must not tear the table down — the rows they were
  // reading stay, with an inline error and retry.
  it("keeps the rows visible and shows an inline error when a refetch fails after data was already loaded", () => {
    mockQuery({ isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<SpecialRequestPage />);

    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  // See `features/orders/OrderListPage.test.tsx` for why paging must not
  // unmount the list.
  it("keeps the rows and the pagination mounted while the next page loads", () => {
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<SpecialRequestPage />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "페이지 탐색" })).toBeInTheDocument();
  });

  // The bar waits out `ListUpdatingRegion`'s show delay on purpose — see the
  // equivalent test in `features/orders/OrderListPage.test.tsx`.
  it("raises the progress bar once the show delay has passed", () => {
    vi.useFakeTimers();
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<SpecialRequestPage />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole("progressbar", { name: "목록을 업데이트하는 중" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("marks the list busy while it is showing a stale page", () => {
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<SpecialRequestPage />);

    expect(screen.getByRole("table").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
  });

  it("shows an error state with a working retry action when the query fails", () => {
    mockQuery({
      data: undefined,
      isError: true,
      error: new Error("요청이 실패했습니다. (500)"),
    });

    render(<SpecialRequestPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  // The defect these three tests exist for: `placeholderData` only holds the
  // previous entry while the new key is *pending*, and lets go the moment
  // that request fails, so a failed page click used to replace the whole
  // list with an error. This screen pages from local state rather than the
  // URL, so the test clicks the real pagination button.
  it("keeps the previous page's rows, with an inline error and retry, when a new page's request fails", async () => {
    await useTheRealSpecialRequestsPageQuery();
    vi.mocked(fetchSpecialRequestsPage).mockImplementation(async (listQuery) => {
      if (listQuery.page === 1) return pageFixture(ITEMS, { page: 1, pageSize: 10, total: 45 });
      throw new Error("요청이 실패했습니다. (500)");
    });

    renderWithQueryClient(<SpecialRequestPage />);
    expect(await screen.findByText("홍길동")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(
      await screen.findByText("요청이 실패해 이전에 불러온 목록을 그대로 보여주고 있습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  // The rows on screen are page 1's, so the pagination and the total must
  // say page 1 — the click asked for page 2, but page 2 never arrived.
  it("keeps the pagination on the page the retained rows actually came from", async () => {
    await useTheRealSpecialRequestsPageQuery();
    vi.mocked(fetchSpecialRequestsPage).mockImplementation(async (listQuery) => {
      if (listQuery.page === 1) return pageFixture(ITEMS, { page: 1, pageSize: 10, total: 45 });
      throw new Error("요청이 실패했습니다. (500)");
    });

    renderWithQueryClient(<SpecialRequestPage />);
    expect(await screen.findByText("홍길동")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "1페이지" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("총 45건")).toBeInTheDocument();
  });

  // Nothing ever succeeded, so there are no rows to preserve and the screen
  // is free to replace itself entirely.
  it("still replaces the whole screen with an error state when the very first load fails", async () => {
    await useTheRealSpecialRequestsPageQuery();
    vi.mocked(fetchSpecialRequestsPage).mockRejectedValue(new Error("요청이 실패했습니다. (500)"));

    renderWithQueryClient(<SpecialRequestPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("특별 요청을 불러오지 못했습니다.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("requests the default query (no gender, empty search, createdAt desc, page 1, a 7-day date range) on first render", () => {
    render(<SpecialRequestPage />);

    expect(useSpecialRequestsPageQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 10,
        gender: undefined,
        search: "",
        sort: "createdAt",
        order: "desc",
      }),
      true,
    );
    const [lastQuery] = useSpecialRequestsPageQueryMock.mock.calls.at(-1) as [{ dateFrom: string; dateTo: string }];
    expect(lastQuery.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lastQuery.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("shows the original empty state when the result is empty with no active filter", () => {
    mockQuery({ data: pageFixture([], { total: 0 }) });

    render(<SpecialRequestPage />);

    expect(screen.getByText("접수된 특별 요청이 없습니다.")).toBeInTheDocument();
  });

  it("keeps the total count out of the title row", () => {
    render(<SpecialRequestPage />);

    const heading = screen.getByRole("heading", { name: "특별 요청" });
    expect(within(heading.parentElement as HTMLElement).queryByText("총 1건")).not.toBeInTheDocument();
    expect(screen.getByText("총 1건")).toBeInTheDocument();
  });

  it("opens a detail dialog showing every field when '상세보기' is clicked", () => {
    render(<SpecialRequestPage />);

    fireEvent.click(screen.getByRole("button", { name: "상세보기" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("5")).toBeInTheDocument();
    expect(within(dialog).getByText("홍길동")).toBeInTheDocument();
    expect(within(dialog).getByText("20대")).toBeInTheDocument();
    expect(within(dialog).getByText("서울")).toBeInTheDocument();
    expect(within(dialog).getByText("@handle")).toBeInTheDocument();
    expect(within(dialog).getByText("친절한 사람")).toBeInTheDocument();
    expect(within(dialog).getByText("소개해주세요")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting, and does not mutate on cancel", () => {
    render(<SpecialRequestPage />);

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    const confirmDialog = screen.getByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "취소" }));

    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("deletes the special request after confirming in the AlertDialog", () => {
    render(<SpecialRequestPage />);

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    const confirmDialog = screen.getByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "삭제" }));

    expect(mutateMock).toHaveBeenCalledWith("s1", expect.anything());
  });

  it("keeps the confirm dialog open while the delete mutation is pending, and closes it only after onSuccess fires", () => {
    render(<SpecialRequestPage />);

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    const confirmDialog = screen.getByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "삭제" }));

    expect(mutateMock).toHaveBeenCalledWith("s1", expect.anything());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    const onSuccess = mutateMock.mock.calls[0][1].onSuccess as () => void;
    act(() => {
      onSuccess();
    });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("disables the delete action while its own mutation is in flight, preventing duplicate submission", () => {
    mockMutation({ isPending: true, variables: "s1" });

    render(<SpecialRequestPage />);

    expect(screen.getByRole("button", { name: "삭제" })).toBeDisabled();
  });

  it("never logs the special request's personal fields to the console", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<SpecialRequestPage />);
    fireEvent.click(screen.getByRole("button", { name: "상세보기" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join(" ");

    expect(allLoggedText).not.toContain("홍길동");
    expect(allLoggedText).not.toContain("@handle");

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("never puts the typed search text into the page URL", async () => {
    vi.useFakeTimers();
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(<SpecialRequestPage />);

    fireEvent.change(screen.getByPlaceholderText("테이블 번호, 이름, 연락처로 검색"), {
      target: { value: "홍길동" },
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(useSpecialRequestsPageQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "홍길동", page: 1 }),
      true,
    );
    expect(window.location.search).not.toContain("홍길동");
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();

    pushStateSpy.mockRestore();
    replaceStateSpy.mockRestore();
    vi.useRealTimers();
  });

  it("shows a distinct 'no results' state when a filter/search yields nothing", async () => {
    vi.useFakeTimers();
    mockQuery({ data: pageFixture([], { total: 0 }) });

    render(<SpecialRequestPage />);

    fireEvent.change(screen.getByPlaceholderText("테이블 번호, 이름, 연락처로 검색"), {
      target: { value: "no-such-name" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText("검색 결과가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("접수된 특별 요청이 없습니다.")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("moves to the next page via Pagination", () => {
    mockQuery({ data: pageFixture(ITEMS, { page: 1, total: 45 }) });

    render(<SpecialRequestPage />);

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(useSpecialRequestsPageQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
      true,
    );
  });
});
