import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/fetch-json", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/fetch-json")>(
    "@/lib/api/fetch-json",
  );
  return { ...actual, fetchJson: vi.fn() };
});

const toastAddMock = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: { add: (...args: unknown[]) => toastAddMock(...args) },
}));

import i18n from "@/i18n/client";
import { FetchJsonError, fetchJson } from "@/lib/api/fetch-json";

import type { InventoryItem } from "./model";
import {
  inventoryKeys,
  useInventoryQuantityAdjuster,
  useRenameExpenseCategoryMutation,
  useSetInventoryQuantityMutation,
} from "./queries";

const fetchJsonMock = vi.mocked(fetchJson);

const GIN: InventoryItem = {
  id: "gin",
  name: "진",
  categoryId: "liquor",
  unit: "병",
  quantity: 5,
  minQuantity: 2,
  isArchived: false,
  needsReorder: false,
  needsCheck: false,
  lastUnitPrice: 30000,
  lastPurchasedAt: null,
  updatedAt: "2026-09-01T00:00:00Z",
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  queryClient.setQueryData(inventoryKeys.list(false), [GIN]);
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const cachedGin = () =>
    queryClient.getQueryData<InventoryItem[]>(inventoryKeys.list(false))?.find((i) => i.id === "gin");
  return { queryClient, wrapper, cachedGin };
}

function adjustCalls() {
  return fetchJsonMock.mock.calls.filter(([url]) => String(url).endsWith("/adjust"));
}

beforeEach(async () => {
  vi.useFakeTimers();
  fetchJsonMock.mockReset();
  toastAddMock.mockReset();
  await i18n.changeLanguage("ko");
});

afterEach(async () => {
  // Unmounting flushes any debounced step, so let it settle before the next
  // test resets the fetch mock.
  cleanup();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

describe("useInventoryQuantityAdjuster", () => {
  it("updates the cache immediately and sends the accumulated delta once after the debounce", async () => {
    const { wrapper, cachedGin } = setup();
    fetchJsonMock.mockResolvedValue({ ...GIN, quantity: 3 });
    const { result } = renderHook(() => useInventoryQuantityAdjuster(), { wrapper });

    act(() => {
      result.current.step(GIN, -1);
      result.current.step(GIN, -1);
      result.current.step(GIN, 1);
      result.current.step(GIN, -1);
    });

    expect(cachedGin()?.quantity).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(adjustCalls()).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(adjustCalls()).toHaveLength(1);
    expect(adjustCalls()[0]).toEqual([
      "/api/admin/inventory-items/gin/adjust",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ delta: -2 }) }),
    ]);
    expect(cachedGin()?.quantity).toBe(3);
    expect(toastAddMock).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });

  it("rolls the optimistic change back and shows an error toast when the adjust fails", async () => {
    const { wrapper, cachedGin } = setup();
    fetchJsonMock.mockRejectedValue(new FetchJsonError(400, "수량은 0보다 작을 수 없습니다."));
    const { result } = renderHook(() => useInventoryQuantityAdjuster(), { wrapper });

    act(() => {
      result.current.step(GIN, -2);
    });
    expect(cachedGin()?.quantity).toBe(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(cachedGin()?.quantity).toBe(5);
    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", description: "수량은 0보다 작을 수 없습니다." }),
    );
  });

  it("offers an undo action on success that sends the opposite delta", async () => {
    const { wrapper, cachedGin } = setup();
    fetchJsonMock.mockResolvedValueOnce({ ...GIN, quantity: 8 });
    const { result } = renderHook(() => useInventoryQuantityAdjuster(), { wrapper });

    act(() => {
      result.current.step(GIN, 3);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const successToast = toastAddMock.mock.calls[0][0] as {
      actionProps?: { children: ReactNode; onClick: () => void };
    };
    expect(successToast.actionProps?.children).toBe("되돌리기");

    fetchJsonMock.mockResolvedValueOnce({ ...GIN, quantity: 5 });
    await act(async () => {
      successToast.actionProps?.onClick();
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(adjustCalls()).toHaveLength(2);
    expect(adjustCalls()[1][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ delta: -3 }) }));
    expect(cachedGin()?.quantity).toBe(5);
  });

  it("keeps later local steps on top of the server response of an earlier request", async () => {
    const { wrapper, cachedGin } = setup();
    let resolveFirst!: (item: InventoryItem) => void;
    fetchJsonMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve as (item: InventoryItem) => void)),
    );
    const { result } = renderHook(() => useInventoryQuantityAdjuster(), { wrapper });

    act(() => {
      result.current.step(GIN, 1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    act(() => {
      result.current.step(GIN, 1);
    });
    expect(cachedGin()?.quantity).toBe(7);

    await act(async () => {
      resolveFirst({ ...GIN, quantity: 6 });
    });

    expect(cachedGin()?.quantity).toBe(7);
  });
});

describe("useSetInventoryQuantityMutation", () => {
  it("sends an absolute quantity and writes the returned item into the cache", async () => {
    const { wrapper, cachedGin } = setup();
    fetchJsonMock.mockResolvedValue({ ...GIN, quantity: 1, needsReorder: true });
    const { result } = renderHook(() => useSetInventoryQuantityMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "gin", quantity: 1 });
    });

    expect(adjustCalls()[0][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ set: 1 }) }));
    expect(cachedGin()).toMatchObject({ quantity: 1, needsReorder: true });
  });
});

describe("useRenameExpenseCategoryMutation", () => {
  it("also invalidates expense queries, which show category names", async () => {
    const { queryClient, wrapper } = setup();
    fetchJsonMock.mockResolvedValue({ id: "liquor", name: "주류", sortOrder: 1, isDefault: true });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRenameExpenseCategoryMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "liquor", name: "주류" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expenses"] });
  });
});
