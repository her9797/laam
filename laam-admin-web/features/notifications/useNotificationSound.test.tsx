import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNotificationSound } from "./useNotificationSound";

const MUTED_STORAGE_KEY = "lam-admin.notifications.muted";

function createOscillatorStub() {
  return {
    type: "sine",
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function createGainStub() {
  return {
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
  };
}

function installAudioContextStub(initialState: "suspended" | "running" = "suspended") {
  const resume = vi.fn();
  const oscillators: ReturnType<typeof createOscillatorStub>[] = [];

  class AudioContextStub {
    state = initialState;
    currentTime = 0;
    destination = {};

    resume() {
      return resume().then(() => {
        this.state = "running";
      });
    }

    createOscillator() {
      const osc = createOscillatorStub();
      oscillators.push(osc);
      return osc;
    }

    createGain() {
      return createGainStub();
    }
  }
  resume.mockResolvedValue(undefined);

  (window as unknown as { AudioContext: unknown }).AudioContext = AudioContextStub;
  return { ctor: AudioContextStub, resume, oscillators };
}

describe("useNotificationSound", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it("reports blocked when the Web Audio API is unavailable (e.g. this test environment) and never throws", () => {
    const { result } = renderHook(() => useNotificationSound());

    expect(result.current.isBlocked).toBe(true);
    expect(() => result.current.playChime()).not.toThrow();
    expect(() => result.current.enableSound()).not.toThrow();
  });

  it("reports blocked while the AudioContext is suspended, and not blocked after enableSound() resumes it", async () => {
    const { resume } = installAudioContextStub("suspended");
    const { result } = renderHook(() => useNotificationSound());

    expect(result.current.isBlocked).toBe(true);

    await act(async () => {
      result.current.enableSound();
    });

    expect(resume).toHaveBeenCalled();
    expect(result.current.isBlocked).toBe(false);
  });

  it("resumes automatically on the first user interaction anywhere on the page, not just via enableSound()", async () => {
    const { resume } = installAudioContextStub("suspended");
    const { result } = renderHook(() => useNotificationSound());

    expect(result.current.isBlocked).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
      await Promise.resolve();
    });

    expect(resume).toHaveBeenCalled();
    expect(result.current.isBlocked).toBe(false);
  });

  it("defaults to unmuted and toggles + persists mute state", () => {
    installAudioContextStub("running");
    const { result } = renderHook(() => useNotificationSound());

    expect(result.current.isMuted).toBe(false);

    act(() => result.current.toggleMuted());
    expect(result.current.isMuted).toBe(true);
    expect(window.localStorage.getItem(MUTED_STORAGE_KEY)).toBe("true");

    act(() => result.current.toggleMuted());
    expect(result.current.isMuted).toBe(false);
    expect(window.localStorage.getItem(MUTED_STORAGE_KEY)).toBe("false");
  });

  it("restores a previously persisted mute preference on mount", () => {
    window.localStorage.setItem(MUTED_STORAGE_KEY, "true");
    installAudioContextStub("running");

    const { result } = renderHook(() => useNotificationSound());

    expect(result.current.isMuted).toBe(true);
  });

  it("playChime() synthesizes a tone via the Web Audio API when enabled and unmuted", () => {
    const { oscillators } = installAudioContextStub("running");
    const { result } = renderHook(() => useNotificationSound());

    act(() => result.current.playChime());

    expect(oscillators.length).toBeGreaterThan(0);
    expect(oscillators[0].start).toHaveBeenCalled();
  });

  it("playChime() does nothing while muted", () => {
    const { oscillators } = installAudioContextStub("running");
    const { result } = renderHook(() => useNotificationSound());

    act(() => result.current.toggleMuted());
    act(() => result.current.playChime());

    expect(oscillators).toHaveLength(0);
  });

  it("playChime() does nothing while blocked", () => {
    const { oscillators } = installAudioContextStub("suspended");
    const { result } = renderHook(() => useNotificationSound());

    act(() => result.current.playChime());

    expect(oscillators).toHaveLength(0);
  });
});
