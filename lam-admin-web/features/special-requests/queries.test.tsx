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

import type { SpecialRequestListQuery } from "./model";
import { useSpecialRequestsPageQuery } from "./queries";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, fetchSpecialRequestsPage: vi.fn() };
});

const QUERY: SpecialRequestListQuery = {
  page: 2,
  pageSize: 10,
  gender: undefined,
  search: "",
  dateFrom: "2026-01-01",
  dateTo: "2026-01-10",
  sort: "createdAt",
  order: "desc",
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper };
}

describe("useSpecialRequestsPageQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Paging changes the query key, and without this the list would unmount to
  // a loading state on every page click — see `SpecialRequestPage`.
  it("keeps the previous page mounted while the next one loads", () => {
    const { Wrapper } = createWrapper();

    renderHook(() => useSpecialRequestsPageQuery(QUERY), { wrapper: Wrapper });

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({
      placeholderData: keepPreviousData,
    });
  });

  // Keeps a revisited page or focus refetch from firing instantly.
  it("keeps a fetched page fresh for 30s", () => {
    const { Wrapper } = createWrapper();

    renderHook(() => useSpecialRequestsPageQuery(QUERY), { wrapper: Wrapper });

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({
      staleTime: 30_000,
    });
  });
});
