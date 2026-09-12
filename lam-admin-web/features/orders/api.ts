import { fetchJson } from "@/lib/api/fetch-json";

import type { OrderListQuery, OrderPageResult, PaymentOrder } from "./model";
import { resolveOrderDateRange } from "./order-date-range";

const PAYMENT_ORDERS_PATH = "/api/admin/payment-orders";

/**
 * Fetches a server-filtered/sorted/paginated page of orders. Mirrors
 * `features/requests/api.ts`'s `fetchCustomerRequestsPage` doc comment,
 * except this endpoint has no legacy unpaginated-array response to
 * preserve — it's new, so it always returns the envelope.
 *
 * `dateFrom`/`dateTo` (date-only strings) are resolved to absolute
 * business-day-bounded `from`/`to` bounds here, at fetch time (see
 * `./order-date-range.ts`), rather than when the URL was parsed — so a
 * bookmarked/shared link's picked dates re-resolve to the actual business
 * day on every fetch, not a stale instant computed when the link was
 * created. When either is blank or the pair is invalid (e.g. from after
 * to), no bound is sent — used by `./queries.ts`'s fixed internal queries,
 * which intentionally want every order regardless of date.
 */
export function fetchOrdersPage(query: OrderListQuery): Promise<OrderPageResult> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
    order: query.order,
  });
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.posSyncStatus) {
    params.set("posSync", query.posSyncStatus);
  }
  if (query.search.trim()) {
    params.set("q", query.search.trim());
  }

  const range = resolveOrderDateRange(query.dateFrom, query.dateTo);
  if (range.ok) {
    params.set("from", range.from.toISOString());
    params.set("to", range.to.toISOString());
  }

  return fetchJson<OrderPageResult>(`${PAYMENT_ORDERS_PATH}?${params.toString()}`, {
    method: "GET",
  });
}

/**
 * Fetches a single order for the order-detail screen (`/orders/{id}`).
 * `lam-api` returns 404 when the id doesn't match any row, which
 * `fetchJson` surfaces as a rejected promise (see that module for the
 * error-shape contract).
 */
export function fetchOrder(orderId: string): Promise<PaymentOrder> {
  return fetchJson<PaymentOrder>(`${PAYMENT_ORDERS_PATH}/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });
}

/**
 * Marks a `READY` order as `ACKNOWLEDGED` — the one manual status
 * transition an operator can trigger (kitchen/bar acknowledging the
 * order); `lam-api` rejects any other `status` value with 400, and never
 * accepts this transition away from a non-`READY` order. `DONE`/`CANCELLED`
 * are POS-webhook-only and have no admin-web mutation.
 */
export function acknowledgeOrder(orderId: string): Promise<PaymentOrder> {
  return fetchJson<PaymentOrder>(`${PAYMENT_ORDERS_PATH}/${encodeURIComponent(orderId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ACKNOWLEDGED" }),
  });
}
