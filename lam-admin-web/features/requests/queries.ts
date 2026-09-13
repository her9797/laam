import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { approveSongRequest } from "@/features/player/api";
import { songQueueKeys } from "@/features/player/keys";

import {
  fetchCustomerRequests,
  fetchCustomerRequestsPage,
  updateCustomerRequestStatus,
  updateCustomerRequestStatuses,
} from "./api";
import type { CustomerRequestListQuery, CustomerRequestStatus } from "./model";

/**
 * Cache keys for the general/song request list (`customer_requests`). Kept
 * separate from `bootstrapKeys` and `specialRequestKeys` — a status change
 * here must only ever touch keys under `requestsKeys.all`.
 *
 * `all` (no params) backs the dashboard's aggregate counts, which need
 * every request regardless of any list screen's current filter/page.
 * `list(query)` backs the paginated `/requests` and `/song-requests`
 * screens — one cache entry per distinct filter/sort/page combination.
 */
export const requestsKeys = {
  all: ["requests"] as const,
  list: (query: CustomerRequestListQuery) => ["requests", "list", query] as const,
};

/**
 * Safety-net poll interval for the notification feature
 * (`docs/plans/2026-09-04-admin-request-notifications.md` section 4.3):
 * Realtime Broadcast is the primary signal, but Broadcast delivery isn't
 * guaranteed, so this query still refetches on its own every 60s. Applied
 * only to `useCustomerRequestsQuery` (the unfiltered `all`-keyed query the
 * notification bell and dashboard both read) — `useCustomerRequestsPageQuery`
 * backs the filtered list screens and isn't part of the alarm data path.
 */
const SAFETY_NET_POLL_INTERVAL_MS = 60_000;

export function useCustomerRequestsQuery() {
  return useQuery({
    queryKey: requestsKeys.all,
    queryFn: fetchCustomerRequests,
    refetchInterval: SAFETY_NET_POLL_INTERVAL_MS,
    // Stop polling once the tab is hidden — an admin who's tabbed away
    // doesn't need this running, and the counterpart focus refetch
    // (`refetchOnWindowFocus: true`, set globally in
    // `lib/query/query-client.ts`) already catches up the moment they
    // return.
    refetchIntervalInBackground: false,
  });
}

/**
 * `enabled` defaults to true for direct callers, but `RequestListPage`
 * passes `false` while its date-range fields are still blank/invalid (see
 * that component's mount effect) — without this, a query would fire once
 * against an unbounded or unresolved range before the real default
 * settles in.
 */
export function useCustomerRequestsPageQuery(query: CustomerRequestListQuery, enabled: boolean = true) {
  return useQuery({
    queryKey: requestsKeys.list(query),
    queryFn: () => fetchCustomerRequestsPage(query),
    enabled,
    // A revisited page or a window-focus refetch shouldn't refire against
    // the server for 30s. Only this list-screen query — the `all`-keyed
    // notification query above keeps its own 60s safety-net poll untouched.
    staleTime: 30_000,
    // See `features/orders/queries.ts`'s equivalent: paging changes the
    // cache key, and without a placeholder `RequestListPage` unmounts its
    // whole list to a spinner on every page click.
    placeholderData: keepPreviousData,
  });
}

export function useUpdateCustomerRequestStatusMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: CustomerRequestStatus }) =>
      updateCustomerRequestStatus(id, status),
    // The endpoint still returns the full, unfiltered/unpaginated list (see
    // `updateCustomerRequestStatus`'s doc comment) — that shape no longer
    // matches every cache entry once list screens can be filtered, sorted,
    // and paginated, so every `requestsKeys.all`-prefixed entry (the plain
    // dashboard query and every `requestsKeys.list(query)` page) is
    // invalidated and refetched under its own current condition instead of
    // being overwritten with the response body.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestsKeys.all });
    },
  });
}

/**
 * Bulk counterpart used by the notification panel's "모두 확인" action
 * (`docs/plans/2026-09-04-admin-request-notifications.md` section 4.5) —
 * same cache-invalidation strategy as `useUpdateCustomerRequestStatusMutation`
 * above, since this endpoint also returns the full unfiltered list.
 */
export function useUpdateCustomerRequestStatusesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: CustomerRequestStatus }) =>
      updateCustomerRequestStatuses(ids, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestsKeys.all });
    },
  });
}

export function useApproveSongRequestMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId }: { requestId: string }) => approveSongRequest(requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestsKeys.all });
      queryClient.invalidateQueries({ queryKey: songQueueKeys.all });
    },
  });
}
