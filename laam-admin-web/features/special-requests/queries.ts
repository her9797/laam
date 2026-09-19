import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteSpecialRequest, fetchSpecialRequestsPage } from "./api";
import type { SpecialRequestListQuery } from "./model";

/**
 * Cache keys for the special request list (`special_requests`). Kept
 * separate from `bootstrapKeys` and `requestsKeys` — a mutation here must
 * only ever touch keys under `specialRequestKeys.all`.
 */
export const specialRequestKeys = {
  all: ["special-requests"] as const,
  list: (query: SpecialRequestListQuery) => ["special-requests", "list", query] as const,
  count: ["special-requests", "count"] as const,
};

/**
 * Dashboard's special-request-count aggregate: every `special_requests` row,
 * all-time, no filter — the same all-time scope `SpecialRequestPage` itself
 * now lists under (this feature sends no date bound at all; see
 * `features/special-requests/api.ts`). `pageSize: 1` keeps the request cheap,
 * mirroring `features/orders/queries.ts`'s `useOrderCountQuery`; only
 * `total` from the paginated envelope is read, never `items`.
 */
const DASHBOARD_SPECIAL_REQUEST_COUNT_QUERY: SpecialRequestListQuery = {
  page: 1,
  pageSize: 1,
  gender: undefined,
  search: "",
  sort: "createdAt",
  order: "desc",
};

export function useSpecialRequestCountQuery() {
  return useQuery({
    queryKey: specialRequestKeys.count,
    queryFn: async () => {
      const page = await fetchSpecialRequestsPage(DASHBOARD_SPECIAL_REQUEST_COUNT_QUERY);
      return { total: page.total };
    },
  });
}

/**
 * Fires on the caller's first render: there is no date range to settle
 * client-side any more, so nothing gates this query.
 */
export function useSpecialRequestsPageQuery(query: SpecialRequestListQuery) {
  return useQuery({
    queryKey: specialRequestKeys.list(query),
    queryFn: () => fetchSpecialRequestsPage(query),
    // A revisited page or a window-focus refetch shouldn't refire against
    // the server for 30s.
    staleTime: 30_000,
    // See `features/orders/queries.ts`'s equivalent: paging changes the
    // cache key, and without a placeholder `SpecialRequestPage` unmounts
    // its whole list to a spinner on every page click.
    placeholderData: keepPreviousData,
  });
}

export function useDeleteSpecialRequestMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteSpecialRequest(id),
    // The endpoint answers 204 No Content, so every
    // `specialRequestKeys.all`-prefixed entry refetches under its own
    // filter/sort/page instead.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: specialRequestKeys.all });
    },
  });
}
