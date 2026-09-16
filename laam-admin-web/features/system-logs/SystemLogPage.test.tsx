import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SystemLog, SystemLogPageResult } from "./model";

const useSystemLogsPageQueryMock = vi.fn();
const refetchMock = vi.fn();

vi.mock("./queries", () => ({
  useSystemLogsPageQuery: (query: unknown) => useSystemLogsPageQueryMock(query),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, fetchSystemLogsPage: vi.fn() };
});

import { fetchSystemLogsPage } from "./api";
import { SystemLogPage } from "./SystemLogPage";

const ITEMS: SystemLog[] = [
  {
    id: "log-1",
    method: "GET",
    path: "/api/v1/admin/orders",
    status: 500,
    message: "internal server error while listing orders",
    createdAt: "2026-09-03T10:00:00Z",
  },
];

function pageFixture(
  items: SystemLog[],
  overrides: Partial<SystemLogPageResult> = {},
): SystemLogPageResult {
  return { items, page: 1, pageSize: 10, total: items.length, ...overrides };
}

function mockQuery(overrides: Partial<ReturnType<typeof defaultQueryResult>> = {}) {
  useSystemLogsPageQueryMock.mockReturnValue({ ...defaultQueryResult(), ...overrides });
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

/**
 * Renders against a real `QueryClient` so a test can drive the actual
 * `useSystemLogsPageQuery` rather than a hand-written result object — see
 * `SpecialRequestPage.test.tsx`'s identical helper for why a hand-written
 * shape can't reproduce a new-key failure.
 */
function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

async function useTheRealSystemLogsPageQuery() {
  const actual = await vi.importActual<typeof import("./queries")>("./queries");
  function useRealSystemLogsPageQuery(listQuery: { page: number; pageSize: number }) {
    return actual.useSystemLogsPageQuery(listQuery);
  }
  useSystemLogsPageQueryMock.mockImplementation(useRealSystemLogsPageQuery);
}

describe("SystemLogPage", () => {
  beforeEach(() => {
    refetchMock.mockClear();
    useSystemLogsPageQueryMock.mockClear();
    vi.mocked(fetchSystemLogsPage).mockReset();
    mockQuery();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state while the system log page is loading", () => {
    mockQuery({ data: undefined, isLoading: true });

    render(<SystemLogPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows a skeleton table, not a centered spinner, on first load", () => {
    mockQuery({ data: undefined, isLoading: true });

    render(<SystemLogPage />);

    const status = screen.getByRole("status");
    expect(status.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(within(status).getByRole("table")).toBeInTheDocument();
  });

  it("shows an error state with a working retry action when the query fails", () => {
    mockQuery({
      data: undefined,
      isError: true,
      error: new Error("요청이 실패했습니다. (500)"),
    });

    render(<SystemLogPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the rows visible and shows an inline error when a refetch fails after data was already loaded", () => {
    mockQuery({ isError: true, error: new Error("요청이 실패했습니다. (500)") });

    render(<SystemLogPage />);

    expect(screen.getByText("GET /api/v1/admin/orders")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("요청이 실패했습니다. (500)");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous page's rows, with an inline error and retry, when a new page's request fails", async () => {
    await useTheRealSystemLogsPageQuery();
    vi.mocked(fetchSystemLogsPage).mockImplementation(async (listQuery) => {
      if (listQuery.page === 1) return pageFixture(ITEMS, { page: 1, pageSize: 10, total: 45 });
      throw new Error("요청이 실패했습니다. (500)");
    });

    renderWithQueryClient(<SystemLogPage />);
    expect(await screen.findByText("GET /api/v1/admin/orders")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(
      await screen.findByText("요청이 실패해 이전에 불러온 목록을 그대로 보여주고 있습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("GET /api/v1/admin/orders")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("still replaces the whole screen with an error state when the very first load fails", async () => {
    await useTheRealSystemLogsPageQuery();
    vi.mocked(fetchSystemLogsPage).mockRejectedValue(new Error("요청이 실패했습니다. (500)"));

    renderWithQueryClient(<SystemLogPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("시스템 로그를 불러오지 못했습니다.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the empty state when the result is empty", () => {
    mockQuery({ data: pageFixture([], { total: 0 }) });

    render(<SystemLogPage />);

    expect(screen.getByText("시스템 로그가 없습니다.")).toBeInTheDocument();
  });

  it("keeps the total count out of the title row", () => {
    render(<SystemLogPage />);

    const heading = screen.getByRole("heading", { name: "시스템 로그" });
    expect(within(heading.parentElement as HTMLElement).queryByText("총 1건")).not.toBeInTheDocument();
    expect(screen.getByText("총 1건")).toBeInTheDocument();
  });

  it("shows the method, path, status, and message columns for each row", () => {
    render(<SystemLogPage />);

    const table = screen.getByRole("table");
    expect(within(table).getByText("GET /api/v1/admin/orders")).toBeInTheDocument();
    expect(within(table).getByText("500")).toBeInTheDocument();
    expect(
      within(table).getByText("internal server error while listing orders"),
    ).toBeInTheDocument();
  });

  it("gives the message cell a title attribute so a long message can be read in full", () => {
    render(<SystemLogPage />);

    const messageCell = screen.getByText("internal server error while listing orders");
    expect(messageCell.closest("td")).toHaveAttribute(
      "title",
      "internal server error while listing orders",
    );
  });

  it("colors the status code as destructive since every entry is a server error", () => {
    render(<SystemLogPage />);

    expect(screen.getByText("500")).toHaveClass("text-destructive");
  });

  it("renders no action column and no delete/retry buttons — this screen is read-only", () => {
    render(<SystemLogPage />);

    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "재시도" })).not.toBeInTheDocument();
  });

  it("moves to the next page via Pagination", () => {
    mockQuery({ data: pageFixture(ITEMS, { page: 1, total: 45 }) });

    render(<SystemLogPage />);

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(useSystemLogsPageQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it("marks the list busy while it is showing a stale page", () => {
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<SystemLogPage />);

    expect(screen.getByRole("table").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
  });

  it("raises the progress bar once the show delay has passed", () => {
    vi.useFakeTimers();
    mockQuery({ isFetching: true, isPlaceholderData: true });

    render(<SystemLogPage />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole("progressbar", { name: "목록을 업데이트하는 중" })).toBeInTheDocument();
    vi.useRealTimers();
  });
});
