import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RequestNotification } from "./model";
import { useNewRequestArrivals } from "./useNewRequestArrivals";

const R1: RequestNotification = { id: "r1", kind: "general", tableNumber: "1", preview: "a", createdAt: "t1" };
const R2: RequestNotification = { id: "r2", kind: "general", tableNumber: "2", preview: "b", createdAt: "t2" };
const R3: RequestNotification = { id: "r3", kind: "song", tableNumber: "3", preview: "c", createdAt: "t3" };

describe("useNewRequestArrivals", () => {
  it("does not report the first load's existing items as arrivals (baseline seed)", () => {
    const { result } = renderHook(
      ({ notifications }) => useNewRequestArrivals(notifications, false),
      { initialProps: { notifications: [R1, R2] } },
    );

    expect(result.current).toEqual([]);
  });

  it("does not treat the pre-load empty placeholder as the baseline (regression: reported every already-pending item as a fresh arrival the instant the real first response loaded)", () => {
    const { result, rerender } = renderHook(
      ({ notifications, isLoading }: { notifications: RequestNotification[]; isLoading: boolean }) =>
        useNewRequestArrivals(notifications, isLoading),
      { initialProps: { notifications: [] as RequestNotification[], isLoading: true } },
    );
    expect(result.current).toEqual([]);

    // The query resolves: `notifications` goes from the loading
    // placeholder `[]` straight to the real, already-pending items.
    rerender({ notifications: [R1, R2], isLoading: false });

    expect(result.current).toEqual([]);
  });

  it("reports an item that appears after the baseline as an arrival", () => {
    const { result, rerender } = renderHook(
      ({ notifications }) => useNewRequestArrivals(notifications, false),
      { initialProps: { notifications: [R1] } },
    );
    expect(result.current).toEqual([]);

    rerender({ notifications: [R1, R2] });

    expect(result.current).toEqual([R2]);
  });

  it("does not re-report the same arrival on a re-render with unchanged notifications", () => {
    const { result, rerender } = renderHook(
      ({ notifications }: { notifications: RequestNotification[] }) =>
        useNewRequestArrivals(notifications, false),
      { initialProps: { notifications: [R1] } },
    );

    rerender({ notifications: [R1, R2] });
    expect(result.current).toEqual([R2]);
    const arrivalsAfterFirstReport = result.current;

    // Same content, new array reference — mirrors a query refetch that
    // resolves to an identical list.
    rerender({ notifications: [R1, R2] });

    // Must not re-fire: the previously reported arrivals array is reused,
    // not recomputed into a fresh (still non-empty) array.
    expect(result.current).toBe(arrivalsAfterFirstReport);
  });

  it("does not report a request that disappears (e.g. gets checked) as an arrival when new ones show up later", () => {
    const { result, rerender } = renderHook(
      ({ notifications }: { notifications: RequestNotification[] }) =>
        useNewRequestArrivals(notifications, false),
      { initialProps: { notifications: [R1, R2] } },
    );

    rerender({ notifications: [R1] }); // R2 disappears (checked)
    rerender({ notifications: [R1, R3] }); // R3 newly appears

    expect(result.current).toEqual([R3]);
  });
});
