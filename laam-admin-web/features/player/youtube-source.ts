import type { YouTubeSource } from "./model";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

function validId(value: string | null): value is string {
  return Boolean(value && ID_PATTERN.test(value));
}

export function parseYouTubeSource(input: string): YouTubeSource | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  if (url.hostname === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    return validId(videoId) ? { kind: "video", id: videoId } : null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname)) {
    return null;
  }

  const playlistId = url.searchParams.get("list");
  if (validId(playlistId)) {
    return { kind: "playlist", id: playlistId };
  }

  const watchVideoId = url.searchParams.get("v");
  if (validId(watchVideoId)) {
    return { kind: "video", id: watchVideoId };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "embed" && validId(parts[1] ?? null)) {
    return { kind: "video", id: parts[1] };
  }

  return null;
}
