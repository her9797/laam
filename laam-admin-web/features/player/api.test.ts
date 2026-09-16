import { afterEach, describe, expect, it, vi } from "vitest";

import { approveSongRequest, fetchSongQueue, updateSongQueueStatus } from "./api";
import type { SongQueueItem } from "./model";

const ITEM: SongQueueItem = {
  id: "queue-1",
  customerRequestId: "request-1",
  tableNumber: "3",
  requestText: "[노래 신청] Ditto - NewJeans",
  youtubeVideoId: "video-123",
  youtubeTitle: "NewJeans - Ditto",
  youtubeChannelTitle: "HYBE LABELS",
  status: "queued",
  queuedAt: "2026-09-06T10:00:00Z",
};

describe("player api", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("approves a song request through the admin BFF", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ITEM), { status: 201 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(approveSongRequest("request-1")).resolves.toEqual(ITEM);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/song-requests/request-1/approve", {
      method: "POST",
    });
  });

  it("fetches the active playback queue", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([ITEM]), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchSongQueue()).resolves.toEqual([ITEM]);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/song-player/queue", { method: "GET" });
  });

  it("updates a queue item's playback status", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await updateSongQueueStatus("queue-1", "completed");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/song-player/queue/queue-1/status");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "completed" });
  });
});
