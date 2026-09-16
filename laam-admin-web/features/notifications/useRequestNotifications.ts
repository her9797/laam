import { useMemo } from "react";

import { useCustomerRequestPendingSummaryQuery } from "@/features/requests/queries";

import { toNotifications } from "./selectors";

/**
 * Read-only view for the notification bell/panel: the newest pending rows
 * from `requestsKeys.pendingSummary` (the same cache the dashboard's pending
 * counts and the 60s safety-net poll already share — see
 * `features/requests/queries.ts`), reshaped through `toNotifications`.
 * `count` is the server-side pending total, so it stays correct even when
 * the list itself is capped.
 * Deliberately has no seen/unseen tracking of its own: the confirmed
 * requirement ties "read" to the server's `pending`→`checked` transition,
 * so there is nothing to track beyond this query's own data.
 */
export function useRequestNotifications() {
  const requestsQuery = useCustomerRequestPendingSummaryQuery();

  const notifications = useMemo(
    () => (requestsQuery.data ? toNotifications(requestsQuery.data.items) : []),
    [requestsQuery.data],
  );

  return {
    notifications,
    count: requestsQuery.data
      ? requestsQuery.data.pendingGeneralCount + requestsQuery.data.pendingSongCount
      : 0,
    isLoading: requestsQuery.isLoading,
    isError: requestsQuery.isError,
  };
}
