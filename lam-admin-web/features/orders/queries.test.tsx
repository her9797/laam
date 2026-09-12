import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrderPageResult } from "./model";
import { useOrderCountQuery } from "./queries";

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
