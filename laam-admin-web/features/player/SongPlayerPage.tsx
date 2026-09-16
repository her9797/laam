"use client";

import "@/i18n/client";

import { RiPlayCircleLine, RiSkipForwardLine } from "@remixicon/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { stripSongRequestPrefix } from "@/features/dashboard/summary";

import type { SongQueueItem, YouTubeSource } from "./model";
import { useSongQueueQuery, useUpdateSongQueueStatusMutation } from "./queries";
import { parseYouTubeSource } from "./youtube-source";

const BACKGROUND_SOURCE_KEY = "lam-player-background-source";
const BACKGROUND_RESUME_KEY = "lam-player-background-resume";

type ResumePoint = { seconds: number; playlistIndex: number };

type YouTubePlayer = {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  loadPlaylist(options: { list: string; index?: number; startSeconds?: number }): void;
  playVideo(): void;
  getCurrentTime(): number;
  getPlaylistIndex(): number;
  destroy(): void;
};

type YouTubePlayerEvent = { target: YouTubePlayer };
type YouTubeStateEvent = YouTubePlayerEvent & { data: number };

type YouTubeNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady(event: YouTubePlayerEvent): void;
        onStateChange(event: YouTubeStateEvent): void;
        onError(event: YouTubePlayerEvent): void;
      };
    },
  ) => YouTubePlayer;
  PlayerState: { ENDED: number };
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeAPIReadyPromise: Promise<YouTubeNamespace> | undefined;

function ensureYouTubeAPI(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (youtubeAPIReadyPromise) {
    return youtubeAPIReadyPromise;
  }

  youtubeAPIReadyPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    const script = existingScript ?? document.createElement("script");
    const timeout = window.setTimeout(() => reject(new Error("youtube iframe api timeout")), 15_000);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      if (window.YT) {
        resolve(window.YT);
      } else {
        reject(new Error("youtube iframe api unavailable"));
      }
    };

    if (!existingScript) {
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("youtube iframe api failed to load"));
      };
      document.head.appendChild(script);
    }
  });

  return youtubeAPIReadyPromise;
}

function readStoredSource(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(BACKGROUND_SOURCE_KEY) ?? "";
  } catch {
    return "";
  }
}

function readStoredResume(): ResumePoint {
  if (typeof window === "undefined") return { seconds: 0, playlistIndex: 0 };
  try {
    const raw = window.localStorage.getItem(BACKGROUND_RESUME_KEY);
    if (!raw) return { seconds: 0, playlistIndex: 0 };
    const parsed = JSON.parse(raw) as Partial<ResumePoint>;
    return {
      seconds: Number.isFinite(parsed.seconds) ? Math.max(0, parsed.seconds ?? 0) : 0,
      playlistIndex: Number.isInteger(parsed.playlistIndex)
        ? Math.max(0, parsed.playlistIndex ?? 0)
        : 0,
    };
  } catch {
    return { seconds: 0, playlistIndex: 0 };
  }
}

function writeStoredPlayback(sourceInput: string, resume: ResumePoint) {
  try {
    window.localStorage.setItem(BACKGROUND_SOURCE_KEY, sourceInput);
    window.localStorage.setItem(BACKGROUND_RESUME_KEY, JSON.stringify(resume));
  } catch {
    // Playback still works when storage is unavailable; only reload recovery is lost.
  }
}

function loadBackground(player: YouTubePlayer, source: YouTubeSource, resume: ResumePoint) {
  if (source.kind === "playlist") {
    player.loadPlaylist({
      list: source.id,
      index: resume.playlistIndex,
      startSeconds: resume.seconds,
    });
  } else {
    player.loadVideoById({ videoId: source.id, startSeconds: resume.seconds });
  }
  player.playVideo();
}

export function SongPlayerPage() {
  const { t } = useTranslation("player");
  const queueQuery = useSongQueueQuery();
  const statusMutation = useUpdateSongQueueStatusMutation();
  const [sourceInput, setSourceInput] = useState(readStoredSource);
  const [sourceError, setSourceError] = useState("");
  const [playbackError, setPlaybackError] = useState("");
  const [isStarted, setIsStarted] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [activeRequest, setActiveRequest] = useState<SongQueueItem | null>(null);

  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const sourceRef = useRef<YouTubeSource | null>(null);
  const sourceInputRef = useRef("");
  const resumeRef = useRef<ResumePoint>({ seconds: 0, playlistIndex: 0 });
  const activeRequestRef = useRef<SongQueueItem | null>(null);
  const isFinishingRequestRef = useRef(false);
  const queueRef = useRef<SongQueueItem[]>([]);
  const mutationRef = useRef(statusMutation.mutateAsync);

  useEffect(() => {
    mutationRef.current = statusMutation.mutateAsync;
  }, [statusMutation.mutateAsync]);

  useEffect(() => {
    queueRef.current = queueQuery.data ?? [];
  }, [queueQuery.data]);

  const resumeBackground = useCallback(() => {
    const player = playerRef.current;
    const source = sourceRef.current;
    if (!player || !source) return;
    loadBackground(player, source, resumeRef.current);
  }, []);

  const playRequest = useCallback((request: SongQueueItem, captureBackground = true) => {
    const player = playerRef.current;
    if (!player || activeRequestRef.current) return;

    if (sourceRef.current && captureBackground) {
      resumeRef.current = {
        seconds: Math.max(0, player.getCurrentTime() || 0),
        playlistIndex: Math.max(0, player.getPlaylistIndex() || 0),
      };
      writeStoredPlayback(sourceInputRef.current, resumeRef.current);
    }

    activeRequestRef.current = request;
    setActiveRequest(request);
    setPlaybackError("");
    player.loadVideoById({ videoId: request.youtubeVideoId });
    player.playVideo();

    if (request.status === "queued") {
      void mutationRef.current({ queueId: request.id, status: "playing" }).catch((error) => {
        setPlaybackError(error instanceof Error ? error.message : t("statusUpdateFailed"));
      });
    }
  }, [t]);

  const finishActiveRequest = useCallback(async () => {
    const finished = activeRequestRef.current;
    if (!finished || isFinishingRequestRef.current) return;
    isFinishingRequestRef.current = true;

    try {
      await mutationRef.current({ queueId: finished.id, status: "completed" });
    } catch (error) {
      setPlaybackError(error instanceof Error ? error.message : t("statusUpdateFailed"));
      isFinishingRequestRef.current = false;
      return;
    }

    queueRef.current = queueRef.current.filter((item) => item.id !== finished.id);
    const next = queueRef.current[0];
    activeRequestRef.current = null;
    isFinishingRequestRef.current = false;
    setActiveRequest(null);
    if (next) {
      playRequest(next, false);
    } else {
      resumeBackground();
    }
  }, [playRequest, resumeBackground, t]);

  useEffect(() => {
    if (!isStarted || !isPlayerReady || activeRequestRef.current) return;
    const next = (queueQuery.data ?? []).find((item) => item.status === "playing") ?? queueQuery.data?.[0];
    if (next) playRequest(next);
  }, [isStarted, isPlayerReady, playRequest, queueQuery.data]);

  useEffect(() => {
    if (!isStarted || !isPlayerReady) return;
    const interval = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || activeRequestRef.current || !sourceRef.current) return;
      resumeRef.current = {
        seconds: Math.max(0, player.getCurrentTime() || 0),
        playlistIndex: Math.max(0, player.getPlaylistIndex() || 0),
      };
      writeStoredPlayback(sourceInputRef.current, resumeRef.current);
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [isPlayerReady, isStarted]);

  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const source = parseYouTubeSource(sourceInput);
    if (!source) {
      setSourceError(t("sourceInvalid"));
      return;
    }

    setSourceError("");
    setPlaybackError("");
    sourceRef.current = source;
    sourceInputRef.current = sourceInput.trim();
    resumeRef.current = readStoredSource() === sourceInput.trim() ? readStoredResume() : { seconds: 0, playlistIndex: 0 };
    writeStoredPlayback(sourceInputRef.current, resumeRef.current);
    setIsStarted(true);

    try {
      const YT = await ensureYouTubeAPI();
      if (playerRef.current) {
        const next = queueRef.current.find((item) => item.status === "playing") ?? queueRef.current[0];
        if (next) playRequest(next);
        else resumeBackground();
        return;
      }
      if (!mountRef.current) return;

      playerRef.current = new YT.Player(mountRef.current, {
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          controls: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: ({ target }) => {
            playerRef.current = target;
            setIsPlayerReady(true);
            const next = queueRef.current.find((item) => item.status === "playing") ?? queueRef.current[0];
            if (next) playRequest(next);
            else resumeBackground();
          },
          onStateChange: (playerEvent) => {
            if (playerEvent.data !== YT.PlayerState.ENDED) return;
            if (activeRequestRef.current) {
              void finishActiveRequest();
            } else if (sourceRef.current?.kind === "video") {
              resumeRef.current = { seconds: 0, playlistIndex: 0 };
              resumeBackground();
            }
          },
          onError: () => {
            if (activeRequestRef.current) void finishActiveRequest();
            else setPlaybackError(t("playbackFailed"));
          },
        },
      });
    } catch {
      setPlaybackError(t("playerLoadFailed"));
    }
  }

  const queue = queueQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("sourceCardTitle")}</CardTitle>
              <CardDescription>{t("sourceCardDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleStart}>
                <FieldGroup>
                  <Field data-invalid={Boolean(sourceError)}>
                    <FieldLabel htmlFor="background-youtube-url">{t("sourceLabel")}</FieldLabel>
                    <Input
                      id="background-youtube-url"
                      type="url"
                      value={sourceInput}
                      onChange={(event) => setSourceInput(event.target.value)}
                      placeholder={t("sourcePlaceholder")}
                      aria-invalid={Boolean(sourceError)}
                    />
                    <FieldDescription>{t("sourceHelp")}</FieldDescription>
                    <FieldError>{sourceError}</FieldError>
                  </Field>
                  <Button type="submit" className="w-fit">
                    <RiPlayCircleLine data-icon="inline-start" aria-hidden="true" />
                    {t("sourceStart")}
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("playbackCardTitle")}</CardTitle>
              <CardDescription aria-live="polite">
                {activeRequest
                  ? t("nowPlayingRequest", { title: activeRequest.youtubeTitle })
                  : isStarted
                    ? t("nowPlayingBackground")
                    : t("notStarted")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="aspect-video min-h-50 overflow-hidden rounded-2xl bg-black">
                <div ref={mountRef} className="h-full min-h-50 w-full" />
              </div>
              {playbackError ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {playbackError}
                </p>
              ) : null}
            </CardContent>
            {activeRequest ? (
              <CardFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void finishActiveRequest()}
                  disabled={statusMutation.isPending}
                >
                  <RiSkipForwardLine data-icon="inline-start" aria-hidden="true" />
                  {t("skipRequest")}
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("queueCardTitle")}</CardTitle>
            <CardDescription>{t("queueCount", { count: queue.length })}</CardDescription>
          </CardHeader>
          <CardContent>
            {queueQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("queueLoading")}</p>
            ) : queueQuery.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {queueQuery.error instanceof Error ? queueQuery.error.message : t("queueLoadFailed")}
              </p>
            ) : queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("queueEmpty")}</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {queue.map((item) => (
                  <li key={item.id} className="rounded-2xl bg-muted/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.youtubeTitle}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("queueItemMeta", {
                            tableNumber: item.tableNumber || "-",
                            request: stripSongRequestPrefix(item.requestText),
                          })}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-background px-2 py-1 text-xs text-muted-foreground">
                        {t(item.status === "playing" ? "statusPlaying" : "statusQueued")}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">{t("foregroundNotice")}</p>
    </div>
  );
}
