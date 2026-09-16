import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderListQuery, OrderPageResult } from "@/features/orders/model";

vi.mock("@/features/orders/api", () => ({
  fetchOrdersPage: vi.fn(),
}));

import { fetchOrdersPage } from "@/features/orders/api";

import { useOrderNotifications } from "./useOrderNotifications";

function order(orderId: string, overrides: Partial<OrderPageResult["items"][number]> = {}) {
  return {
    orderId,
    menuItemName: "하우스 하이볼",
    categoryName: "하이볼",
    tableNumber: "7",
    requestNote: "",
    amount: 10000,
    vat: 909,
    suppliedAmount: 9091,
    taxFreeAmount: 0,
    status: "DONE" as const,
    posSyncStatus: "SUCCEEDED" as const,
    approvedAt: "2026-09-04T10:00:30Z",
    createdAt: "2026-09-04T10:00:00Z",
    ...overrides,
  };
}

const fixture: OrderPageResult = {
  items: [order("o1")],
  page: 1,
  pageSize: 20,
  total: 1,
};

const twoOrderFixture: OrderPageResult = {
  items: [order("o1"), order("o2", { approvedAt: "2026-09-04T11:00:00Z" })],
  page: 1,
  pageSize: 20,
  total: 2,
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("useOrderNotifications", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("derives the completed-sale alarm list from the orders query", async () => {
    vi.mocked(fetchOrdersPage).mockResolvedValue(fixture);

    const { result } = renderHook(() => useOrderNotifications(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.notifications.map((item) => item.id)).toEqual(["o1"]);
  });

  it("asks the server only for paid orders, newest first, without a date bound", async () => {
    vi.mocked(fetchOrdersPage).mockResolvedValue(fixture);

    const { result } = renderHook(() => useOrderNotifications(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const query = vi.mocked(fetchOrdersPage).mock.calls[0]?.[0] as OrderListQuery;
    expect(query.status).toBe("DONE");
    expect(query.sort).toBe("createdAt");
    expect(query.order).toBe("desc");
    // Blank, not the business-day-bounded "today": the bell must not
    // depend on the business-day window, or a sale rung up outside
    // business hours never alarms.
    expect(query.dateFrom).toBe("");
    expect(query.dateTo).toBe("");
    expect(query.page).toBe(1);
  });

  it("returns an empty list while loading", () => {
    vi.mocked(fetchOrdersPage).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useOrderNotifications(), { wrapper: createWrapper() });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it("exposes count as the number of undismissed orders", async () => {
    vi.mocked(fetchOrdersPage).mockResolvedValue(twoOrderFixture);

    const { result } = renderHook(() => useOrderNotifications(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.count).toBe(2);
  });

  it("removes an order from the list and count once dismiss(id) is called", async () => {
    vi.mocked(fetchOrdersPage).mockResolvedValue(twoOrderFixture);

    const { result } = renderHook(() => useOrderNotifications(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.dismiss("o1");
    });

    expect(result.current.notifications.map((item) => item.id)).toEqual(["o2"]);
    expect(result.current.count).toBe(1);
  });

  it("persists a dismissal in localStorage so it survives a reload", async () => {
    vi.mocked(fetchOrdersPage).mockResolvedValue(twoOrderFixture);

    const first = renderHook(() => useOrderNotifications(), { wrapper: createWrapper() });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    act(() => {
      first.result.current.dismiss("o1");
    });

    // A fresh mount (new QueryClient too) simulates a page reload: the
    // dismissal must come back from localStorage, not from in-memory state.
    const second = renderHook(() => useOrderNotifications(), { wrapper: createWrapper() });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));

    expect(second.result.current.notifications.map((item) => item.id)).toEqual(["o2"]);
  });
});
