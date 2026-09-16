import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CustomerRequestPendingSummary } from "@/features/requests/model";

vi.mock("@/features/requests/api", () => ({
  fetchCustomerRequestPendingSummary: vi.fn(),
}));

import { fetchCustomerRequestPendingSummary } from "@/features/requests/api";

import { useRequestNotifications } from "./useRequestNotifications";

const fixture: CustomerRequestPendingSummary = {
  pendingGeneralCount: 1,
  pendingSongCount: 1,
  items: [
    { id: "r1", tableNumber: "3", text: "물 좀 주세요", status: "pending", createdAt: "2026-09-04T10:05:00Z" },
    { id: "r2", tableNumber: "5", text: "[노래 신청] 아무 노래", status: "pending", createdAt: "2026-09-04T10:01:00Z" },
  ],
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("useRequestNotifications", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("derives the notification list and count from the pending summary query", async () => {
    vi.mocked(fetchCustomerRequestPendingSummary).mockResolvedValue(fixture);
    const Wrapper = createWrapper();

    const { result } = renderHook(() => useRequestNotifications(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.count).toBe(2);
    expect(result.current.notifications.map((item) => item.id)).toEqual(["r1", "r2"]);
  });

  // `items` is capped server-side to the newest pending rows, so the badge
  // count must come from the summary's totals rather than the list length.
  it("counts every pending request even when items are capped", async () => {
    vi.mocked(fetchCustomerRequestPendingSummary).mockResolvedValue({
      ...fixture,
      pendingGeneralCount: 120,
      pendingSongCount: 30,
    });
    const Wrapper = createWrapper();

    const { result } = renderHook(() => useRequestNotifications(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.count).toBe(150);
    expect(result.current.notifications).toHaveLength(2);
  });

  it("returns an empty list while loading", () => {
    vi.mocked(fetchCustomerRequestPendingSummary).mockReturnValue(new Promise(() => {}));
    const Wrapper = createWrapper();

    const { result } = renderHook(() => useRequestNotifications(), { wrapper: Wrapper });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.isLoading).toBe(true);
  });
});
