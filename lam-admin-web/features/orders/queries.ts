import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { acknowledgeOrder, fetchOrder, fetchOrdersPage } from "./api";
import type { OrderListQuery, PaymentOrderStatus } from "./model";

/**
 * Cache keys for `payment_orders`. Kept separate from every other
 * feature's keys — nothing in the admin web mutates orders, so the only
 * writer here is the `new_order` Realtime signal
 * (`features/notifications/useOrderBroadcast.ts`), which invalidates the
 * whole `all` prefix because a completed sale can land on any page of any
 * filter combination.
 *
 * `list(query)` backs the paginated `/orders` screen — one cache entry per
 * distinct filter/sort/page combination. `notifications` is the bell's own
 * fixed-shape query, deliberately not sharing an entry with the list
 * screen so its safety-net poll can't attach itself to whatever the
 * operator happens to be browsing.
 */
export const orderKeys = {
  all: ["orders"] as const,
  list: (query: OrderListQuery) => ["orders", "list", query] as const,
  notifications: ["orders", "notifications"] as const,
  count: ["orders", "count"] as const,
  detail: (orderId: string) => ["orders", "detail", orderId] as const,
};

/**
 * `enabled` defaults to true for direct callers, but `OrderListPage` passes
 * `false` while its date-range fields are still blank/invalid (see that
 * component's mount effect and `../orders/order-date-range.ts`) — without
 * this, a query would fire once against an unbounded or unresolved range
 * before the real default settles in.
 */
export function useOrdersPageQuery(query: OrderListQuery, enabled: boolean = true) {
  return useQuery({
    queryKey: orderKeys.list(query),
    queryFn: () => fetchOrdersPage(query),
    enabled,
  });
}

/**
 * Safety-net poll for the completed-sale alarm, matching the interval
 * `features/requests/queries.ts` uses for the same reason: Realtime
 * Broadcast is the primary signal, but its delivery isn't guaranteed, so
 * the alarm data still refetches on its own.
 */
const SAFETY_NET_POLL_INTERVAL_MS = 60_000;

/**
 * The bell's fixed view of `payment_orders`: the most recent paid orders,
 * newest first.
 *
 * `dateFrom`/`dateTo` left blank (unbounded) on purpose. The order-history
 * screen's own date filter means the venue's buffered business day, which
 * is a forward-looking window when the clock is outside it — a sale rung
 * up at an odd hour would fall outside that window and never alarm. An
 * unbounded, server-limited "last N sales" query has no such boundary, and
 * costs the same.
 *
 * `pageSize` only has to cover how many sales can complete between two
 * refreshes; it is the arrival-detection window, not a list the operator
 * reads.
 */
const NOTIFICATION_QUERY: OrderListQuery = {
  page: 1,
  pageSize: 20,
  status: "DONE",
  search: "",
  dateFrom: "",
  dateTo: "",
  sort: "createdAt",
  order: "desc",
};

export function useOrderNotificationsQuery() {
  return useQuery({
    queryKey: orderKeys.notifications,
    queryFn: () => fetchOrdersPage(NOTIFICATION_QUERY),
    refetchInterval: SAFETY_NET_POLL_INTERVAL_MS,
    // Stop polling once the tab is hidden, like the request-side query —
    // the global `refetchOnWindowFocus` catches the operator up when they
    // come back.
    refetchIntervalInBackground: false,
  });
}

/**
 * Dashboard's order-history aggregate: every order still awaiting payment,
 * all-time — unlike `/orders`'s own default filter (see `list-query-url.ts`'s
 * `DEFAULT_STATUS`), which shows every status. `pageSize: 1` keeps each
 * request cheap; only `total` from the paginated envelope is read, never
 * `items`.
 *
 * "Unpaid" spans two statuses, not one: an order stays unpaid after a staff
 * member acknowledges it (READY → ACKNOWLEDGED), and only leaves that state
 * on a POS webhook (→ DONE/CANCELLED). Counting READY alone would silently
 * drop an order from this card the moment someone pressed 주문확인, while it
 * was still sitting unpaid on the table. The list endpoint's `status` filter
 * takes a single value, so the two are fetched separately and summed here
 * rather than widening that API contract for one dashboard card.
 */
const DASHBOARD_UNPAID_STATUSES = ["READY", "ACKNOWLEDGED"] as const;

function buildDashboardOrderCountQuery(status: PaymentOrderStatus): OrderListQuery {
  return {
    page: 1,
    pageSize: 1,
    status,
    search: "",
    dateFrom: "",
    dateTo: "",
    sort: "createdAt",
    order: "desc",
  };
}

export function useOrderCountQuery() {
  return useQuery({
    queryKey: orderKeys.count,
    queryFn: async () => {
      const pages = await Promise.all(
        DASHBOARD_UNPAID_STATUSES.map((status) =>
          fetchOrdersPage(buildDashboardOrderCountQuery(status)),
        ),
      );
      return { total: pages.reduce((sum, page) => sum + page.total, 0) };
    },
  });
}

/**
 * The order-detail screen's single-order fetch (`/orders/{orderId}`). A
 * separate cache entry per id, not part of the `list`/`notifications`
 * prefixes above — those are pages of many orders, this is one order read
 * directly (e.g. a refreshed or bookmarked detail URL).
 */
export function useOrderQuery(orderId: string) {
  return useQuery({
    queryKey: orderKeys.detail(orderId),
    queryFn: () => fetchOrder(orderId),
  });
}

/**
 * The order-detail screen's "주문확인" action. `lam-api` returns the
 * updated order, but this invalidates the whole `orderKeys.all` prefix
 * (list, notifications, count, and every detail entry) rather than writing
 * the response directly into a single cache entry — the same
 * refetch-under-current-condition strategy `features/requests/queries.ts`'s
 * status mutation uses, since the list screen's active filter/page could
 * differ from what this response describes.
 */
export function useAcknowledgeOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) => acknowledgeOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}
