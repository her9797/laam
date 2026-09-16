import { QueryClient, QueryClientProvider, keepPreviousData, useQuery } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return { ...actual, useQuery: vi.fn(actual.useQuery) };
});

import type { SystemLogListQuery } from "./model";
import { useSystemLogsPageQuery } from "./queries";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper };
}

const LIST_QUERY: SystemLogListQuery = { page: 2, pageSize: 10 };

describe("useSystemLogsPageQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Paging changes the query key, and without a placeholder the screen would
  // fall back to its page-level loading state and unmount the list on every
  // page click — same reasoning as `useCustomerRequestsPageQuery`.
  it("keeps the previous page's data while the next page loads", () => {
    const { Wrapper } = createWrapper();

    renderHook(() => useSystemLogsPageQuery(LIST_QUERY), { wrapper: Wrapper });

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({
      placeholderData: keepPreviousData,
    });
  });

  it("keeps a fetched page fresh for 30s", () => {
    const { Wrapper } = createWrapper();

    renderHook(() => useSystemLogsPageQuery(LIST_QUERY), { wrapper: Wrapper });

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({
      staleTime: 30_000,
    });
  });
});
