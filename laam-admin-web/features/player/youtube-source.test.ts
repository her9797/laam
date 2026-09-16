import { describe, expect, it } from "vitest";

import { parseYouTubeSource } from "./youtube-source";

describe("parseYouTubeSource", () => {
  it.each([
    ["https://www.youtube.com/watch?v=video_123", { kind: "video", id: "video_123" }],
    ["https://youtu.be/video-456?t=10", { kind: "video", id: "video-456" }],
    ["https://www.youtube.com/embed/video789", { kind: "video", id: "video789" }],
    ["https://music.youtube.com/playlist?list=PL_test-123", { kind: "playlist", id: "PL_test-123" }],
    [
      "https://www.youtube.com/watch?v=first-video&list=PL_test-456",
      { kind: "playlist", id: "PL_test-456" },
    ],
  ])("parses %s", (input, expected) => {
    expect(parseYouTubeSource(input)).toEqual(expected);
  });

  it.each([
    "",
    "not a url",
    "https://example.com/watch?v=video123",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/playlist",
  ])("rejects an invalid source: %s", (input) => {
    expect(parseYouTubeSource(input)).toBeNull();
  });
});
