import { fetchJson } from "@/lib/api/fetch-json";
import { resolveCalendarDateRange } from "@/lib/date-range";

import type {
  CustomerRequest,
  CustomerRequestListQuery,
  CustomerRequestPageResult,
  CustomerRequestStatus,
} from "./model";

const CUSTOMER_REQUESTS_PATH = "/api/admin/customer-requests";

export function fetchCustomerRequests(): Promise<CustomerRequest[]> {
  return fetchJson<CustomerRequest[]>(CUSTOMER_REQUESTS_PATH, { method: "GET" });
}

/**
 * Fetches a server-filtered/sorted/paginated page. Reaching `laam-api` with
 * at least one recognized query param switches its response from the
 * legacy plain array (`fetchCustomerRequests` above) to the
 * `{ items, page, pageSize, total }` envelope this returns — see
 * `docs/plans/2026-09-04-admin-list-paging-search-sort.md` section 4.3.
 * `page`/`pageSize`/`kind`/`sort`/`order` are always sent (so a caller of
 * this function always gets the envelope), `status` only when set, and an
 * empty `search` is omitted so the server never has to special-case "".
 *
 * `dateFrom`/`dateTo` (date-only strings) are resolved to absolute
 * calendar-day-bounded `from`/`to` bounds here, at fetch time (see
 * `@/lib/date-range.ts`), rather than when the URL was parsed. When either
 * is blank or the pair is invalid, no bound is sent.
 */
export function fetchCustomerRequestsPage(
  query: CustomerRequestListQuery,
): Promise<CustomerRequestPageResult> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    kind: query.kind,
    sort: query.sort,
    order: query.order,
  });
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.search.trim()) {
    params.set("q", query.search);
  }

  const range = resolveCalendarDateRange(query.dateFrom, query.dateTo);
  if (range.ok) {
    params.set("from", range.from.toISOString());
    params.set("to", range.to.toISOString());
  }

  return fetchJson<CustomerRequestPageResult>(`${CUSTOMER_REQUESTS_PATH}?${params.toString()}`, {
    method: "GET",
  });
}

/**
 * `laam-api`'s `PATCH /api/v1/admin/customer-requests/{id}/status` (proxied
 * here as `/api/admin/customer-requests/{id}/status`) returns the full,
 * refreshed request list in the same response — so callers can write that
 * straight into the `requestsKeys.all` cache entry instead of triggering a
 * second round trip.
 */
export function updateCustomerRequestStatus(
  id: string,
  status: CustomerRequestStatus,
): Promise<CustomerRequest[]> {
  return fetchJson<CustomerRequest[]>(`${CUSTOMER_REQUESTS_PATH}/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

/**
 * `laam-api`'s `PATCH /api/v1/admin/customer-requests` (collection path, no
 * id segment) applies `status` to every id in one statement and returns the
 * full, refreshed request list — see
 * `docs/plans/2026-09-04-admin-request-notifications.md` section 4.5 for why
 * this exists instead of one `updateCustomerRequestStatus` call per id
 * (atomicity; a single round trip instead of N).
 */
export function updateCustomerRequestStatuses(
  ids: string[],
  status: CustomerRequestStatus,
): Promise<CustomerRequest[]> {
  return fetchJson<CustomerRequest[]>(CUSTOMER_REQUESTS_PATH, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, status }),
  });
}
