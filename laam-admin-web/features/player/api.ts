import { fetchJson } from "@/lib/api/fetch-json";

import type { SongQueueItem, SongQueueUpdateStatus } from "./model";

export function approveSongRequest(requestId: string): Promise<SongQueueItem> {
  return fetchJson<SongQueueItem>(`/api/admin/song-requests/${requestId}/approve`, {
    method: "POST",
  });
}

export function fetchSongQueue(): Promise<SongQueueItem[]> {
  return fetchJson<SongQueueItem[]>("/api/admin/song-player/queue", { method: "GET" });
}

export function updateSongQueueStatus(
  queueId: string,
  status: SongQueueUpdateStatus,
): Promise<void> {
  return fetchJson<void>(`/api/admin/song-player/queue/${queueId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
