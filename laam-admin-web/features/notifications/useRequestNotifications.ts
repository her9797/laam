import { useMemo } from "react";

import { useCustomerRequestsQuery } from "@/features/requests/queries";

import { toNotifications } from "./selectors";

/**
 * Read-only view for the notification bell/panel: the pending subset of
 * `requestsKeys.all` (the same cache the dashboard's aggregate counts and
 * the 60s safety-net poll already share — see
 * `features/requests/queries.ts`), reshaped through `toNotifications`.
 * Deliberately has no seen/unseen tracking of its own: the confirmed
 * requirement ties "read" to the server's `pending`→`checked` transition,
 * so there is nothing to track beyond this query's own data.
 */
export function useRequestNotifications() {
  const requestsQuery = useCustomerRequestsQuery();

  const notifications = useMemo(
    () => (requestsQuery.data ? toNotifications(requestsQuery.data) : []),
    [requestsQuery.data],
  );

  return {
    notifications,
    count: notifications.length,
    isLoading: requestsQuery.isLoading,
    isError: requestsQuery.isError,
  };
}
