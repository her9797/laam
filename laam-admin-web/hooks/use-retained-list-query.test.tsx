import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  useQuery,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useRetainedListQuery } from "./use-retained-list-query";

type Page = { items: string[]; page: number; pageSize: number; total: number };

function pageFixture(page: number, items: string[]): Page {
  return { items, page, pageSize: 10, total: 45 };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

/**
 * Mirrors what every list screen's query hook does — a per-page cache key
 * plus `keepPreviousData` — so these tests exercise React Query's real
 * behaviour rather than a hand-written `{ isError, data }` object. That
 * hand-written shape is exactly what let the defect through: it can model
 * a *same-key* refetch failure (where React Query keeps `data`) but never
 * a *new-key* failure, where React Query drops it.
 */
function useListPageQuery(fetchPage: (page: number) => Promise<Page>, page: number) {
  return useQuery({
    queryKey: ["list", page],
    queryFn: () => fetchPage(page),
    placeholderData: keepPreviousData,
  });
}

function renderRetained(fetchPage: (page: number) => Promise<Page>, wrapper: ReturnType<typeof createWrapper>["Wrapper"]) {
  return renderHook(
    ({ page }: { page: number }) =>
      useRetainedListQuery(useListPageQuery(fetchPage, page), { page, pageSize: 10 }),
    { initialProps: { page: 1 }, wrapper },
  );
}

describe("useRetainedListQuery", () => {
  // The premise behind the whole hook, pinned so a React Query upgrade that
  // changes it fails here rather than silently re-breaking the screens:
  // when a *new* query key's request fails, `keepPreviousData` lets go of
  // the previous entry's data, leaving `status: "error"` with no data at all.
  it("pins React Query's own behaviour: a new key's failure leaves no data behind", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1) return pageFixture(1, ["a", "b"]);
      throw new Error("boom");
    });
    const { Wrapper } = createWrapper();

    const { result, rerender } = renderHook(
      ({ page }: { page: number }) => useListPageQuery(fetchPage, page),
      { initialProps: { page: 1 }, wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ page: 2 });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("hands back the last successful page when a new key's request fails", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1) return pageFixture(1, ["a", "b"]);
      throw new Error("boom");
    });
    const { Wrapper } = createWrapper();

    const { result, rerender } = renderRetained(fetchPage, Wrapper);
    await waitFor(() => expect(result.current.data?.items).toEqual(["a", "b"]));

    rerender({ page: 2 });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data?.items).toEqual(["a", "b"]);
    expect(result.current.isRetained).toBe(true);
  });

  // The rows on screen belong to the page that actually loaded, so the
  // pagination and the total must describe that page — not the page the
  // failed request asked for.
  it("reports the retained page and size while it is serving a retained result", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1) return pageFixture(1, ["a", "b"]);
      throw new Error("boom");
    });
    const { Wrapper } = createWrapper();

    const { result, rerender } = renderRetained(fetchPage, Wrapper);
    await waitFor(() => expect(result.current.data?.items).toEqual(["a", "b"]));

    rerender({ page: 2 });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.total).toBe(45);
  });

  it("reports the requested page while the query is healthy", async () => {
    const fetchPage = vi.fn(async (page: number) => pageFixture(page, ["a"]));
    const { Wrapper } = createWrapper();

    const { result } = renderRetained(fetchPage, Wrapper);
    await waitFor(() => expect(result.current.data?.items).toEqual(["a"]));

    expect(result.current.page).toBe(1);
    expect(result.current.isRetained).toBe(false);
  });

  // Nothing has ever succeeded, so there are no rows to preserve: the screen
  // must be free to replace itself with a full error state.
  it("retains nothing when the very first load fails", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error("boom");
    });
    const { Wrapper } = createWrapper();

    const { result } = renderRetained(fetchPage, Wrapper);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.isRetained).toBe(false);
  });

  // Stale rows must not outlive their usefulness: the next success replaces
  // the snapshot, so a later failure preserves the newest page, not the
  // oldest one.
  it("replaces the snapshot once a later request succeeds", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 3) throw new Error("boom");
      return pageFixture(page, [`page-${page}`]);
    });
    const { Wrapper } = createWrapper();

    const { result, rerender } = renderRetained(fetchPage, Wrapper);
    await waitFor(() => expect(result.current.data?.items).toEqual(["page-1"]));

    rerender({ page: 2 });
    await waitFor(() => expect(result.current.data?.items).toEqual(["page-2"]));

    rerender({ page: 3 });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data?.items).toEqual(["page-2"]);
    expect(result.current.page).toBe(2);
  });

  // `aria-busy` is the screen's "what you are looking at is not what you
  // asked for" signal, and a retained result is exactly that.
  it("marks the result stale while it is retained", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1) return pageFixture(1, ["a"]);
      throw new Error("boom");
    });
    const { Wrapper } = createWrapper();

    const { result, rerender } = renderRetained(fetchPage, Wrapper);
    await waitFor(() => expect(result.current.data?.items).toEqual(["a"]));
    expect(result.current.isStale).toBe(false);

    rerender({ page: 2 });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.isStale).toBe(true);
  });

  // A retained result is something to show, so the screen must not fall back
  // to its first-load skeleton while the operator keeps clicking.
  it("stops reporting a first load while it holds a snapshot", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1) return pageFixture(1, ["a"]);
      throw new Error("boom");
    });
    const { Wrapper } = createWrapper();

    const { result, rerender } = renderRetained(fetchPage, Wrapper);
    await waitFor(() => expect(result.current.data?.items).toEqual(["a"]));

    rerender({ page: 2 });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.isLoading).toBe(false);
  });
});
