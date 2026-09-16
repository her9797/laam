import {
  selectGeneralRequests,
  selectSongRequests,
  stripSongRequestPrefix,
} from "@/features/dashboard/summary";
import type { CustomerRequest } from "@/features/requests/model";

import type { RequestNotification, RequestNotificationKind } from "./model";

function toNotification(
  request: CustomerRequest,
  kind: RequestNotificationKind,
): RequestNotification {
  return {
    id: request.id,
    kind,
    tableNumber: request.tableNumber,
    preview: kind === "song" ? stripSongRequestPrefix(request.text) : request.text,
    createdAt: request.createdAt,
  };
}

/**
 * Builds the alarm list from the full `customer_requests` snapshot: only
 * `pending` rows become a notification (the confirmed requirement ties
 * "read" to the server's own status, so there is no separate seen/unseen
 * store), classified general vs. song through `features/dashboard/summary`'s
 * single source of truth rather than re-checking the `[노래 신청]` prefix
 * here, and sorted newest first.
 */
export function toNotifications(requests: CustomerRequest[]): RequestNotification[] {
  const pending = requests.filter((request) => request.status === "pending");
  const general = selectGeneralRequests(pending).map((request) =>
    toNotification(request, "general"),
  );
  const song = selectSongRequests(pending).map((request) => toNotification(request, "song"));

  return [...general, ...song].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
