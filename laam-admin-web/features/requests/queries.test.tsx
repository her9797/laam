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

import type { CustomerRequest, CustomerRequestListQuery } from "./model";
import {
  useCustomerRequestsPageQuery,
  useCustomerRequestsQuery,
  useUpdateCustomerRequestStatusesMutation,
} from "./queries";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    fetchCustomerRequests: vi.fn(),
    updateCustomerRequestStatuses: vi.fn(),
  };
});

import { fetchCustomerRequests, updateCustomerRequestStatuses } from "./api";

const fixture: CustomerRequest[] = [
  { id: "r1", tableNumber: "1", text: "물", status: "pending", createdAt: "2026-09-04T10:00:00Z" },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

const LIST_QUERY: CustomerRequestListQuery = {
  page: 2,
  pageSize: 10,
  status: undefined,
  kind: "general",
  search: "",
  dateFrom: "2026-01-01",
  dateTo: "2026-01-10",
  sort: "createdAt",
  order: "desc",
};

describe("useCustomerRequestsPageQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Paging changes the query key, and without a placeholder
  // `RequestListPage` falls back to its page-level loading state and
  // unmounts the list on every page click.
  it("keeps the previous page's data while the next page loads", () => {
    const { Wrapper } = createWrapper();

    renderHook(() => useCustomerRequestsPageQuery(LIST_QUERY), { wrapper: Wrapper });

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({
      placeholderData: keepPreviousData,
    });
  });

  // Keeps a revisited page or focus refetch from firing instantly — this is
  // the list-screen-only query, not the notification `all` query below,
  // whose safety-net poll must keep firing regardless.
  it("keeps a fetched page fresh for 30s", () => {
    const { Wrapper } = createWrapper();

    renderHook(() => useCustomerRequestsPageQuery(LIST_QUERY), { wrapper: Wrapper });

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({
      staleTime: 30_000,
    });
  });
});

describe("useCustomerRequestsQuery safety-net polling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The interval firing and TanStack Query's own focusManager/visibility
  // gating are the library's tested behavior, not ours. What this hook is
  // responsible for is passing the right config — so this asserts on the
  // options handed to the real `useQuery`, rather than re-simulating the
  // library's internal interval/focus scheduling with fake timers (which
  // proved flaky: setInterval callbacks and the focusManager's own
  // `visibilitychange` listener interact in ways this component doesn't
  // control).
  it("configures a 60s safety-net poll that stops while the tab is hidden", async () => {
    vi.mocked(fetchCustomerRequests).mockResolvedValue(fixture);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useCustomerRequestsQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
      }),
    );
  });
});

describe("useUpdateCustomerRequestStatusesMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the bulk API and invalidates every requestsKeys.all-prefixed cache entry", async () => {
    vi.mocked(updateCustomerRequestStatuses).mockResolvedValue(fixture);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateCustomerRequestStatusesMutation(), {
      wrapper: Wrapper,
    });

    result.current.mutate({ ids: ["r1"], status: "checked" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateCustomerRequestStatuses).toHaveBeenCalledWith(["r1"], "checked");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["requests"] });
  });
});
