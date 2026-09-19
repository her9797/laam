import { fetchJson } from "@/lib/api/fetch-json";

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

  // No `from`/`to`: this screen lists every special request, all-time. The
  // endpoint still accepts the bounds — see `features/requests/api.ts`, which
  // does send them — but this feature never does.

  return fetchJson<SpecialRequestPageResult>(`${SPECIAL_REQUESTS_PATH}?${params.toString()}`, {
    method: "GET",
  });
}

/**
 * `laam-api`'s `DELETE /api/v1/admin/special-requests/{id}` (proxied here as
 * `/api/admin/special-requests/{id}`) answers 204 No Content; callers
 * invalidate `specialRequestKeys.all` to refetch.
 */
export function deleteSpecialRequest(id: string): Promise<void> {
  return fetchJson<void>(`${SPECIAL_REQUESTS_PATH}/${id}`, {
    method: "DELETE",
  });
}
