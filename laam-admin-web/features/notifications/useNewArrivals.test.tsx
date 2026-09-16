import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useNewArrivals } from "./useNewArrivals";

type Item = { id: string; label: string };

const A: Item = { id: "a", label: "first" };
const B: Item = { id: "b", label: "second" };

describe("useNewArrivals", () => {
  it("works for any id-bearing shape, not just request notifications", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: Item[] }) => useNewArrivals(items, false),
      { initialProps: { items: [A] } },
    );

    expect(result.current).toEqual([]);

    rerender({ items: [A, B] });

    expect(result.current).toEqual([B]);
  });

  it("does not seed its baseline from the empty placeholder while loading", () => {
    const { result, rerender } = renderHook(
      ({ items, isLoading }: { items: Item[]; isLoading: boolean }) =>
        useNewArrivals(items, isLoading),
      { initialProps: { items: [] as Item[], isLoading: true } },
    );

    rerender({ items: [A, B], isLoading: false });

    expect(result.current).toEqual([]);
  });

  it("keeps the same array reference when nothing new arrived", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: Item[] }) => useNewArrivals(items, false),
      { initialProps: { items: [A] } },
    );

    rerender({ items: [A, B] });
    const afterArrival = result.current;

    rerender({ items: [A, B] });

    expect(result.current).toBe(afterArrival);
  });
});
