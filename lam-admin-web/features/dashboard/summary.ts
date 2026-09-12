import type { AppData } from "@/features/bootstrap/model";
import type { CustomerRequest } from "@/features/requests/model";
import type { SpecialRequest } from "@/features/special-requests/model";

/**
 * `lam-web`'s `song-requests-screen.tsx` (customer side, creates the
 * request) and `admin-screen.tsx` (admin side, reads it back) both encode
 * "song request" as the *same* `customer_requests` resource — there is no
 * separate song-request model or table. The two screens agree on a single
 * convention: a request is a song request only when its `text` starts with
 * the literal prefix below (`customerRequests.filter((item) =>
 * item.text.startsWith("[노래 신청]"))` in `admin-screen.tsx`).
 *
 * This module is the one place that rule lives for `lam-admin-web`. Both
 * `features/requests/RequestListPage.tsx` (shared by the `/requests` and
 * `/song-requests` routes) and this dashboard's own aggregation read the
 * classification from here — neither re-implements the `startsWith` check,
 * so the two pages can never drift into showing overlapping or duplicated
 * items.
 */
const SONG_REQUEST_PREFIX = "[노래 신청]";

export function isSongRequest(request: Pick<CustomerRequest, "text">): boolean {
  return request.text.startsWith(SONG_REQUEST_PREFIX);
}

export function selectSongRequests(requests: CustomerRequest[]): CustomerRequest[] {
  return requests.filter((request) => isSongRequest(request));
}

export function selectGeneralRequests(requests: CustomerRequest[]): CustomerRequest[] {
  return requests.filter((request) => !isSongRequest(request));
}

/**
 * Strips the classification prefix for display only, mirroring
 * `admin-screen.tsx`'s regex that trims a leading "[노래 신청]" (plus any
 * following whitespace) off `customerRequest.text`. This is a presentation
 * detail — `isSongRequest` above stays the only source of truth for
 * *classification*; nothing should decide song-vs-general by checking
 * whether this stripped a prefix.
 */
export function stripSongRequestPrefix(text: string): string {
  return text.replace(/^\[노래 신청\]\s*/, "");
}

export type DashboardSummary = {
  pendingGeneralRequestCount: number;
  pendingSongRequestCount: number;
  specialRequestCount: number;
  orderCount: number;
  menuItemCount: number;
  noticeCount: number;
};

function countPending(requests: CustomerRequest[]): number {
  return requests.filter((request) => request.status === "pending").length;
}

/**
 * Aggregates the dashboard's shortcut-card counts from the already-separate
 * feature queries (`AppData` from `bootstrapKeys.all`, `CustomerRequest[]`
 * from `requestsKeys.all`, `SpecialRequest[]` from `specialRequestKeys.all`,
 * and the `payment_orders` total from `orderKeys.count`). Pure and
 * synchronous — callers own fetching and caching; this only ever combines
 * already-loaded data, so it never merges the general/special request or
 * order API calls, models, or mutation flows themselves.
 *
 * `orderCount` is passed in as a plain number rather than an order array:
 * it is a server-side total (from `OrderPageResult.total`) of the orders
 * still awaiting payment — both `READY` and `ACKNOWLEDGED` — regardless of
 * `/orders`'s own default filter. See `features/orders/queries.ts`'s
 * `useOrderCountQuery`.
 */
export function buildDashboardSummary(
  appData: AppData,
  requests: CustomerRequest[],
  specialRequests: SpecialRequest[],
  orderCount: number,
): DashboardSummary {
  return {
    pendingGeneralRequestCount: countPending(selectGeneralRequests(requests)),
    pendingSongRequestCount: countPending(selectSongRequests(requests)),
    specialRequestCount: specialRequests.length,
    orderCount,
    menuItemCount: appData.items.length,
    noticeCount: appData.notices.length,
  };
}
