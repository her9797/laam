import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteSpecialRequest, fetchSpecialRequests, fetchSpecialRequestsPage } from "./api";
import type { SpecialRequestListQuery } from "./model";

/**
 * Cache keys for the special request list (`special_requests`). Kept
 * separate from `bootstrapKeys` and `requestsKeys` — a mutation here must
 * only ever touch keys under `specialRequestKeys.all`.
 */
export const specialRequestKeys = {
  all: ["special-requests"] as const,
  list: (query: SpecialRequestListQuery) => ["special-requests", "list", query] as const,
};

export function useSpecialRequestsQuery() {
  return useQuery({
    queryKey: specialRequestKeys.all,
    queryFn: fetchSpecialRequests,
  });
}

/**
 * `enabled` defaults to true for direct callers, but `SpecialRequestPage`
 * passes `false` while its date-range fields are still blank/invalid (see
 * that component's mount effect) — without this, a query would fire once
 * against an unbounded or unresolved range before the real default
 * settles in.
 */
export function useSpecialRequestsPageQuery(query: SpecialRequestListQuery, enabled: boolean = true) {
  return useQuery({
    queryKey: specialRequestKeys.list(query),
    queryFn: () => fetchSpecialRequestsPage(query),
    enabled,
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
    // See `features/requests/queries.ts`'s equivalent mutation for why this
    // invalidates rather than writes the response body into the cache: the
    // endpoint still returns the full, unpaginated list, which no longer
    // matches a filtered/sorted/paginated `specialRequestKeys.list(query)`
    // entry.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: specialRequestKeys.all });
    },
  });
}
