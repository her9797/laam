import type { OrderPageResult } from "@/features/orders/model";

import type { OrderNotification } from "./model";

/**
 * Builds the "new order arrived" alarm list from one page of
 * `payment_orders`.
 *
 * Kept in its own module rather than merged into `selectors.ts`: customer
 * requests and payment orders are separate flows with separate sources,
 * and the request selectors' central rule (only `pending` rows count,
 * because "read" is a server-owned status) has no counterpart here —
 * `payment_orders` has no read state, so `useNewArrivals` does the
 * seen/unseen work on the client instead.
 *
 * `status` is re-checked even though the query already asks the server for
 * `DONE` only: a `READY` row is an order that was started and never paid,
 * and letting one through would announce an order that never actually
 * arrived.
 *
 * `approvedAt` falls back to `createdAt` because it is only guaranteed
 * once the payment provider confirms; the two are seconds apart for a
 * completed order, and the fallback keeps sorting total rather than
 * leaving a row with no timestamp to order by.
 */
export function toOrderNotifications(page: OrderPageResult): OrderNotification[] {
  return page.items
    .filter((order) => order.status === "DONE")
    .map((order) => ({
      id: order.orderId,
      tableNumber: order.tableNumber,
      menuItemName: order.menuItemName,
      amount: order.amount,
      approvedAt: order.approvedAt ?? order.createdAt,
    }))
    .sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : -1));
}
