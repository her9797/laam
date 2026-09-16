import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestsKeys } from "@/features/requests/queries";

import { BROADCAST_REFETCH_INTERVAL_MS } from "./broadcast-throttle";

type BroadcastCallback = (message: { payload: unknown }) => void;

function createFakeChannel() {
  let registeredCallback: BroadcastCallback | null = null;
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, callback: BroadcastCallback) => {
      registeredCallback = callback;
      return channel;
    }),
    subscribe: vi.fn(() => channel),
    // Test-only helper, not part of the real RealtimeChannel API.
    __trigger: (payload: unknown) => registeredCallback?.({ payload }),
  };
  return channel;
}

const getSupabaseClientMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => getSupabaseClientMock(),
}));

import { useRequestBroadcast } from "./useRequestBroadcast";

function Harness() {
  useRequestBroadcast();
  return null;
}

function renderWithClient(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("useRequestBroadcast", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when Supabase isn't configured (getSupabaseClient() returns null)", () => {
    getSupabaseClientMock.mockReturnValue(null);
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    expect(() => renderWithClient(queryClient)).not.toThrow();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("subscribes to the admin-requests channel's new_request broadcast event", () => {
    const channel = createFakeChannel();
    const removeChannel = vi.fn();
    getSupabaseClientMock.mockReturnValue({
      channel: vi.fn(() => channel),
      removeChannel,
    });
    const queryClient = new QueryClient();

    renderWithClient(queryClient);

    expect(channel.on).toHaveBeenCalledWith(
      "broadcast",
      { event: "new_request" },
      expect.any(Function),
    );
    expect(channel.subscribe).toHaveBeenCalled();
  });

  it("invalidates requestsKeys.all when a new_request broadcast arrives", () => {
    const channel = createFakeChannel();
    getSupabaseClientMock.mockReturnValue({
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    });
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderWithClient(queryClient);
    channel.__trigger({ type: "new_request" });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: requestsKeys.all });
  });

  it("removes the channel on unmount", () => {
    const channel = createFakeChannel();
    const removeChannel = vi.fn();
    const supabase = { channel: vi.fn(() => channel), removeChannel };
    getSupabaseClientMock.mockReturnValue(supabase);
    const queryClient = new QueryClient();

    const { unmount } = renderWithClient(queryClient);
    unmount();

    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  describe("coalescing a flood of signals", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function renderSubscribed() {
      const channel = createFakeChannel();
      getSupabaseClientMock.mockReturnValue({
        channel: vi.fn(() => channel),
        removeChannel: vi.fn(),
      });
      const queryClient = new QueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { unmount } = renderWithClient(queryClient);
      return { channel, invalidateSpy, unmount };
    }

    it("invalidates on the first of 50 signals immediately and folds the rest into one trailing refetch", () => {
      const { channel, invalidateSpy } = renderSubscribed();

      for (let i = 0; i < 50; i++) {
        channel.__trigger({ type: "new_request" });
      }
      expect(invalidateSpy).toHaveBeenCalledTimes(1);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: requestsKeys.all });

      vi.advanceTimersByTime(BROADCAST_REFETCH_INTERVAL_MS);
      expect(invalidateSpy).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(BROADCAST_REFETCH_INTERVAL_MS * 10);
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
    });

    it("invalidates immediately again for a signal arriving after the interval has passed", () => {
      const { channel, invalidateSpy } = renderSubscribed();

      channel.__trigger({ type: "new_request" });
      vi.advanceTimersByTime(BROADCAST_REFETCH_INTERVAL_MS);
      expect(invalidateSpy).toHaveBeenCalledTimes(1);

      channel.__trigger({ type: "new_request" });
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
    });

    it("drops a pending trailing refetch on unmount", () => {
      const { channel, invalidateSpy, unmount } = renderSubscribed();

      channel.__trigger({ type: "new_request" });
      channel.__trigger({ type: "new_request" });
      unmount();
      vi.advanceTimersByTime(BROADCAST_REFETCH_INTERVAL_MS * 10);

      expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });

    it("ignores a signal delivered after unmount", () => {
      const { channel, invalidateSpy, unmount } = renderSubscribed();

      unmount();
      // The fake channel keeps its callback after `removeChannel`, as a real
      // one does until the server acknowledges the leave.
      channel.__trigger({ type: "new_request" });
      vi.advanceTimersByTime(BROADCAST_REFETCH_INTERVAL_MS * 10);

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });
});
