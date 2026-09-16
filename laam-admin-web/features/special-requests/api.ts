import { fetchJson } from "@/lib/api/fetch-json";
import { resolveCalendarDateRange } from "@/lib/date-range";

import type { SpecialRequest, SpecialRequestListQuery, SpecialRequestPageResult } from "./model";

const SPECIAL_REQUESTS_PATH = "/api/admin/special-requests";

export function fetchSpecialRequests(): Promise<SpecialRequest[]> {
  return fetchJson<SpecialRequest[]>(SPECIAL_REQUESTS_PATH, { method: "GET" });
}

/**
 * Fetches a server-filtered/sorted/paginated page — see
 * `features/requests/api.ts`'s `fetchCustomerRequestsPage` doc comment for
 * the shared legacy-array-vs-envelope contract this mirrors.
 */
export function fetchSpecialRequestsPage(
  query: SpecialRequestListQuery,
): Promise<SpecialRequestPageResult> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
    order: query.order,
  });
  if (query.gender) {
    params.set("gender", query.gender);
  }
  if (query.search.trim()) {
    params.set("q", query.search);
  }

  const range = resolveCalendarDateRange(query.dateFrom, query.dateTo);
  if (range.ok) {
    params.set("from", range.from.toISOString());
    params.set("to", range.to.toISOString());
  }

  return fetchJson<SpecialRequestPageResult>(`${SPECIAL_REQUESTS_PATH}?${params.toString()}`, {
    method: "GET",
  });
}

/**
 * `laam-api`'s `DELETE /api/v1/admin/special-requests/{id}` (proxied here as
 * `/api/admin/special-requests/{id}`) returns the full, refreshed list in
 * the same response — so callers can write that straight into the
 * `specialRequestKeys.all` cache entry instead of a second round trip.
 */
export function deleteSpecialRequest(id: string): Promise<SpecialRequest[]> {
  return fetchJson<SpecialRequest[]>(`${SPECIAL_REQUESTS_PATH}/${id}`, {
    method: "DELETE",
  });
}
