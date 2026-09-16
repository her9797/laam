export type SongQueueStatus = "queued" | "playing";
export type SongQueueUpdateStatus = "playing" | "completed";

export type SongQueueItem = {
  id: string;
  customerRequestId: string;
  tableNumber: string;
  requestText: string;
  youtubeVideoId: string;
  youtubeTitle: string;
  youtubeChannelTitle: string;
  status: SongQueueStatus;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type YouTubeSource =
  | { kind: "video"; id: string }
  | { kind: "playlist"; id: string };
