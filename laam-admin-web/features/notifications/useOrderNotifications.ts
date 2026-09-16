import { useCallback, useEffect, useMemo, useState } from "react";

import { useOrderNotificationsQuery } from "@/features/orders/queries";

import { readDismissedOrderIds, writeDismissedOrderIds } from "./order-dismissal";
import { toOrderNotifications } from "./order-selectors";

/**
 * "An order just came in" alarm feed — the order-side counterpart of
 * `useRequestNotifications`. Built from recently completed
 * (`payment_orders.status = "DONE"`) orders because that is the moment an
 * order actually needs the operator's attention — the point is noticing
 * the order, not recording the sale.
 *
 * `count`/`notifications` only reflect orders not yet dismissed via
 * `dismiss(id)`. Unlike customer requests, `payment_orders` has no
 * server-owned read state, so "처리됨" here is a client-only concept
 * persisted to `localStorage` (`order-dismissal.ts`) rather than a status
 * flip on the server — same trade-off already made for the mute
 * preference in `useNotificationSound`. This feeds arrival detection
 * (`useNewArrivals`) for the toast/chime and the panel's list, both driven
 * off the same undismissed set.
 */
export function useOrderNotifications() {
  const ordersQuery = useOrderNotificationsQuery();
  // Starts empty (matching the server's render, which has no localStorage)
  // rather than reading `readDismissedOrderIds()` in the initializer — that
  // would return real, possibly non-empty data on the client's first render
  // and mismatch the server-rendered HTML (the bell's badge count and
  // aria-label), breaking hydration. There is no render-time read of
  // localStorage that both the server and the client's first render can
  // agree on, so applying the real value after mount is the fix, not the
  // problem — same exception already taken in `SalesStatsPage`.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissedIds(readDismissedOrderIds());
  }, []);

  const allOrders = useMemo(
    () => (ordersQuery.data ? toOrderNotifications(ordersQuery.data) : []),
    [ordersQuery.data],
  );

  const notifications = useMemo(
    () => allOrders.filter((order) => !dismissedIds.has(order.id)),
    [allOrders, dismissedIds],
  );

  const dismiss = useCallback((id: string) => {
    setDismissedIds((previous) => {
      if (previous.has(id)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(id);
      writeDismissedOrderIds(next);
      return next;
    });
  }, []);

  return {
    notifications,
    count: notifications.length,
    isLoading: ordersQuery.isLoading,
    dismiss,
  };
}
