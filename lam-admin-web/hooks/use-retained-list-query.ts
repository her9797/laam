"use client";

import { useState } from "react";

/**
 * One page of a list endpoint's paginated envelope. Only the positioning
 * fields matter here — the rows themselves stay opaque to this hook, so
 * orders, general requests, and special requests all pass through unchanged.
 */
export type ListPageEnvelope = {
  page: number;
  pageSize: number;
  total: number;
};

/**
 * The slice of a React Query result this hook reads. Declared structurally
 * rather than as `UseQueryResult` so a list screen's query hook can be
 * swapped or wrapped without this file caring, and so tests can hand it a
 * plain object.
 */
export type ListQueryLike<TData> = {
  data: TData | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
  error: unknown;
  refetch: () => unknown;
};

export type RetainedListQuery<TData> = {
  /** The current page, or the last one that loaded when the current one has none. */
  data: TData | undefined;
  /** True while `data` is a preserved earlier result rather than the requested one. */
  isRetained: boolean;
  /** True only while there is nothing at all to show yet — a genuine first load. */
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  /** True while what is on screen is not what the current query asked for. */
  isStale: boolean;
  /** The page the rows on screen actually belong to. */
  page: number;
  /** The page size those rows were fetched with. */
  pageSize: number;
  /** The total that goes with those rows. */
  total: number;
  refetch: () => unknown;
};

/**
 * Holds on to the last list page that actually loaded, and serves it when
 * the current query has nothing of its own.
 *
 * `placeholderData: keepPreviousData` alone does not cover this. It serves
 * the previous cache entry only while the *new* query key is pending, and
 * lets go the instant that request fails: React Query then reports
 * `status: "error"` with `data: undefined`. So the two failure shapes are
 * not the same, and a screen that branches on `isError && !data` splits them
 * apart by accident:
 *
 *   - same key (window focus, broadcast invalidate) — the entry keeps its
 *     data, the rows survive, and the screen shows an inline error;
 *   - new key (page, filter, sort, or date change) — the data is gone, and
 *     the screen falls through to its whole-page error state, wiping out the
 *     list the operator was reading.
 *
 * This hook closes that gap by keeping its own snapshot of the last
 * successful result. A later success replaces the snapshot, so a retained
 * page is never more than one failure old.
 *
 * The snapshot's rows belong to the page that actually loaded, not the one
 * the URL now asks for, so `page`/`pageSize`/`total` come from the snapshot
 * while it is being served — a pagination reading "2" over page 1's rows and
 * page 1's total would be the screen lying about what it is showing.
 * Callers pass what they requested as `requested`, which is what gets
 * reported whenever nothing is being retained.
 */
export function useRetainedListQuery<TData extends ListPageEnvelope>(
  query: ListQueryLike<TData>,
  requested: { page: number; pageSize: number },
): RetainedListQuery<TData> {
  const [snapshot, setSnapshot] = useState<TData | undefined>(undefined);

  // State adjusted during render rather than from an effect — the same
  // pattern the list screens use to sync their search box to the URL. React
  // re-runs this render with the new snapshot instead of committing a frame
  // with the old one, so no extra paint and nothing to clean up. (A ref is
  // what this would naturally be, but a ref read during render is exactly
  // what `react-hooks/refs` forbids.)
  //
  // Placeholder data *is* the previous entry's data, so recording it would
  // only ever re-store what is already there — skipped to keep the snapshot
  // meaning exactly "a result this query really resolved".
  if (
    query.isSuccess &&
    !query.isPlaceholderData &&
    query.data !== undefined &&
    query.data !== snapshot
  ) {
    setSnapshot(query.data);
  }

  const retained = query.data === undefined ? snapshot : undefined;
  const data = query.data ?? retained;

  return {
    data,
    isRetained: retained !== undefined,
    // A retained page is something to show, so the screen must not drop back
    // to its first-load skeleton — that teardown is the very thing this hook
    // exists to prevent, and it would otherwise reappear the moment an
    // operator changed pages again from an error.
    isLoading: query.isLoading && retained === undefined,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    isStale: query.isPlaceholderData || retained !== undefined,
    page: retained?.page ?? requested.page,
    pageSize: retained?.pageSize ?? requested.pageSize,
    total: data?.total ?? 0,
    refetch: query.refetch,
  };
}
