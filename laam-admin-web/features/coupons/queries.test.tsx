import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/i18n/client";

const redeemMock = vi.fn();
const resetMock = vi.fn();
const toastAddMock = vi.fn();

vi.mock("./api", () => ({
  listSecretCoupons: vi.fn(),
  updateSecretCoupon: vi.fn(),
  redeemSecretCoupon: (...args: unknown[]) => redeemMock(...args),
  resetSecretCoupon: (...args: unknown[]) => resetMock(...args),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: { add: (...args: unknown[]) => toastAddMock(...args) },
}));

import { FetchJsonError } from "@/lib/api/fetch-json";

import {
  couponKeys,
  useRedeemSecretCouponMutation,
  useResetSecretCouponMutation,
} from "./queries";

const VARS = { id: "c2", claimedAt: "2026-10-03T10:00:00Z" };
const CONFLICT_TITLE = "쿠폰 상태가 바뀌었어요. 최신 목록을 다시 불러왔어요.";

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { invalidate, wrapper };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("coupon mutations", () => {
  it("passes id and claimedAt to the redeem and reset api", async () => {
    redeemMock.mockResolvedValue({});
    resetMock.mockResolvedValue({});
    const { wrapper } = setup();
    const redeem = renderHook(() => useRedeemSecretCouponMutation(), { wrapper });
    const reset = renderHook(() => useResetSecretCouponMutation(), { wrapper });

    await act(() => redeem.result.current.mutateAsync(VARS));
    await act(() => reset.result.current.mutateAsync(VARS));

    expect(redeemMock).toHaveBeenCalledWith("c2", "2026-10-03T10:00:00Z");
    expect(resetMock).toHaveBeenCalledWith("c2", "2026-10-03T10:00:00Z");
  });

  it("shows the conflict toast and refreshes the list on 409 (redeem)", async () => {
    redeemMock.mockRejectedValue(new FetchJsonError(409, "already reset"));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useRedeemSecretCouponMutation(), { wrapper });

    act(() => result.current.mutate(VARS));

    await waitFor(() => expect(toastAddMock).toHaveBeenCalled());
    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", title: CONFLICT_TITLE }),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: couponKeys.all }));
  });

  it("shows the conflict toast and refreshes the list on 409 (reset)", async () => {
    resetMock.mockRejectedValue(new FetchJsonError(409, "claimedAt mismatch"));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useResetSecretCouponMutation(), { wrapper });

    act(() => result.current.mutate(VARS));

    await waitFor(() => expect(toastAddMock).toHaveBeenCalled());
    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", title: CONFLICT_TITLE }),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: couponKeys.all }));
  });

  it("keeps the server message toast for other failures but still refreshes", async () => {
    redeemMock.mockRejectedValue(new FetchJsonError(500, "boom"));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useRedeemSecretCouponMutation(), { wrapper });

    act(() => result.current.mutate(VARS));

    await waitFor(() => expect(toastAddMock).toHaveBeenCalled());
    expect(toastAddMock).toHaveBeenCalledWith({
      type: "error",
      title: "교환 처리에 실패했습니다.",
      description: "boom",
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: couponKeys.all }));
  });
});
