import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  useQuery,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return { ...actual, useQuery: vi.fn(actual.useQuery) };
});

import type { OrderListQuery, OrderPageResult } from "./model";
import { useOrderCountQuery, useOrdersPageQuery } from "./queries";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, fetchOrdersPage: vi.fn() };
});

import { fetchOrdersPage } from "./api";

const fixture: OrderPageResult = { items: [], page: 1, pageSize: 1, total: 3 };

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper };
}

const LIST_QUERY: OrderListQuery = {
  page: 2,
  pageSize: 10,
  status: undefined,
  posSyncStatus: undefined,
  search: "",
  dateFrom: "2026-01-01",
  dateTo: "2026-01-10",
  sort: "createdAt",
  order: "desc",
};

describe("useOrdersPageQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Every page/filter change is a new query key. Without a placeholder the
  // hook reports `isLoading` again and `OrderListPage` unmounts its whole
  // list to a spinner, which is what made paging flicker and jump.
  it("keeps the previous page's data while the next page loads", () => {
    const { Wrapper } = createWrapper();

    renderHook(() => useOrdersPageQuery(LIST_QUERY), { wrapper: Wrapper });

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({
      placeholderData: keepPreviousData,
    });
  });

  // A cached page revisited within 30s (or a window-focus refetch) should
  // not immediately refire — see `ListUpdatingRegion`'s show-delay, which
  // this staleTime is what makes irrelevant for the common case.
  it("keeps a fetched page fresh for 30s", () => {
    const { Wrapper } = createWrapper();

    renderHook(() => useOrdersPageQuery(LIST_QUERY), { wrapper: Wrapper });

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({
      staleTime: 30_000,
    });
  });
});

describe("useOrderCountQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The dashboard card counts unpaid orders, and an order stays unpaid
  // across both READY and ACKNOWLEDGED — acknowledging one must not drop it
  // from the card. Asserting on both calls is what catches a regression back
  // to counting a single status.
  it("counts both READY and ACKNOWLEDGED (unpaid) orders", async () => {
    vi.mocked(fetchOrdersPage).mockResolvedValue(fixture);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useOrderCountQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchOrdersPage).toHaveBeenCalledWith(expect.objectContaining({ status: "READY" }));
    expect(fetchOrdersPage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ACKNOWLEDGED" }),
    );
  });

  it("sums the totals of both unpaid statuses", async () => {
    vi.mocked(fetchOrdersPage)
      .mockResolvedValueOnce({ ...fixture, total: 3 })
      .mockResolvedValueOnce({ ...fixture, total: 2 });
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useOrderCountQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.total).toBe(5);
  });
});
