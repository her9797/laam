import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CustomerRequest } from "@/features/requests/model";

vi.mock("@/features/requests/api", () => ({
  fetchCustomerRequests: vi.fn(),
}));

import { fetchCustomerRequests } from "@/features/requests/api";

import { useRequestNotifications } from "./useRequestNotifications";

const fixture: CustomerRequest[] = [
  { id: "r1", tableNumber: "3", text: "물 좀 주세요", status: "pending", createdAt: "2026-09-04T10:05:00Z" },
  { id: "r2", tableNumber: "5", text: "[노래 신청] 아무 노래", status: "pending", createdAt: "2026-09-04T10:01:00Z" },
  { id: "r3", tableNumber: "1", text: "처리 완료", status: "completed", createdAt: "2026-09-04T09:00:00Z" },
];

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

  it("derives the pending-only notification list and count from the customer requests query", async () => {
    vi.mocked(fetchCustomerRequests).mockResolvedValue(fixture);
    const Wrapper = createWrapper();

    const { result } = renderHook(() => useRequestNotifications(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.count).toBe(2);
    expect(result.current.notifications.map((item) => item.id)).toEqual(["r1", "r2"]);
  });

  it("returns an empty list while loading", () => {
    vi.mocked(fetchCustomerRequests).mockReturnValue(new Promise(() => {}));
    const Wrapper = createWrapper();

    const { result } = renderHook(() => useRequestNotifications(), { wrapper: Wrapper });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.isLoading).toBe(true);
  });
});
