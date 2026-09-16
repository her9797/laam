import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SongQueueItem } from "./model";

let queue: SongQueueItem[] = [];
const mutateAsyncMock = vi.fn(async () => undefined);

vi.mock("./queries", () => ({
  useSongQueueQuery: () => ({
    data: queue,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUpdateSongQueueStatusMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}));

import "@/i18n/client";

import { SongPlayerPage } from "./SongPlayerPage";

const REQUEST: SongQueueItem = {
  id: "queue-1",
  customerRequestId: "request-1",
  tableNumber: "3",
  requestText: "[노래 신청] Ditto - NewJeans",
  youtubeVideoId: "request-video",
  youtubeTitle: "NewJeans - Ditto",
  youtubeChannelTitle: "HYBE LABELS",
  status: "queued",
  queuedAt: "2026-09-06T10:00:00Z",
};

const SECOND_REQUEST: SongQueueItem = {
  ...REQUEST,
  id: "queue-2",
  customerRequestId: "request-2",
  youtubeVideoId: "second-request-video",
  youtubeTitle: "IVE - I AM",
  queuedAt: "2026-09-06T10:01:00Z",
};

describe("SongPlayerPage", () => {
  let player: {
    loadVideoById: ReturnType<typeof vi.fn>;
    loadPlaylist: ReturnType<typeof vi.fn>;
    playVideo: ReturnType<typeof vi.fn>;
    getCurrentTime: ReturnType<typeof vi.fn>;
    getPlaylistIndex: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  let playerEvents: {
    onReady: (event: { target: typeof player }) => void;
    onStateChange: (event: { data: number; target: typeof player }) => void;
    onError: (event: { target: typeof player }) => void;
  };

  beforeEach(() => {
    queue = [];
    mutateAsyncMock.mockClear();
    window.localStorage.clear();
    player = {
      loadVideoById: vi.fn(),
      loadPlaylist: vi.fn(),
      playVideo: vi.fn(),
      getCurrentTime: vi.fn(() => 321),
      getPlaylistIndex: vi.fn(() => 0),
      destroy: vi.fn(),
    };
    const Player = vi.fn(function PlayerMock(
      _element: HTMLElement,
      options: { events: typeof playerEvents },
    ) {
      playerEvents = options.events;
      options.events.onReady({ target: player });
      return player;
    });
    Object.assign(window, { YT: { Player, PlayerState: { ENDED: 0 } } });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "YT");
  });

  it("plays approved requests in order and resumes background from the original saved position", async () => {
    const { rerender } = render(<SongPlayerPage />);

    fireEvent.change(screen.getByLabelText("기본 음악 YouTube URL"), {
      target: { value: "https://www.youtube.com/watch?v=background-video" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "기본 음악 재생 시작" }));
    });

    expect(player.loadVideoById).toHaveBeenCalledWith({
      videoId: "background-video",
      startSeconds: 0,
    });

    queue = [REQUEST, SECOND_REQUEST];
    rerender(<SongPlayerPage />);

    await act(async () => {});
    expect(mutateAsyncMock).toHaveBeenCalledWith({ queueId: "queue-1", status: "playing" });
    expect(player.loadVideoById).toHaveBeenLastCalledWith({ videoId: "request-video" });

    await act(async () => {
      playerEvents.onStateChange({ data: 0, target: player });
    });

    expect(mutateAsyncMock).toHaveBeenCalledWith({ queueId: "queue-1", status: "completed" });
    expect(mutateAsyncMock).toHaveBeenCalledWith({ queueId: "queue-2", status: "playing" });
    expect(player.loadVideoById).toHaveBeenLastCalledWith({ videoId: "second-request-video" });

    await act(async () => {
      playerEvents.onStateChange({ data: 0, target: player });
    });

    expect(mutateAsyncMock).toHaveBeenCalledWith({ queueId: "queue-2", status: "completed" });
    expect(player.loadVideoById).toHaveBeenLastCalledWith({
      videoId: "background-video",
      startSeconds: 321,
    });
  });

  it("rejects a non-YouTube background URL", () => {
    render(<SongPlayerPage />);

    fireEvent.change(screen.getByLabelText("기본 음악 YouTube URL"), {
      target: { value: "https://example.com/music" },
    });
    fireEvent.click(screen.getByRole("button", { name: "기본 음악 재생 시작" }));

    expect(screen.getByRole("alert")).toHaveTextContent("올바른 YouTube 영상 또는 재생목록 URL을 입력하세요.");
  });
});
