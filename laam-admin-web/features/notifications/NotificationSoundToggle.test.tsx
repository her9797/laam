import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/i18n/client";

import type { UseNotificationSoundResult } from "./useNotificationSound";
import { NotificationSoundToggle } from "./NotificationSoundToggle";

const playChimeMock = vi.fn();
const enableSoundMock = vi.fn();
const toggleMutedMock = vi.fn();

function sound(overrides: Partial<UseNotificationSoundResult> = {}): UseNotificationSoundResult {
  return {
    isBlocked: false,
    isMuted: false,
    toggleMuted: toggleMutedMock,
    enableSound: enableSoundMock,
    playChime: playChimeMock,
    ...overrides,
  };
}

describe("NotificationSoundToggle", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a 'sound blocked' button that resumes audio on click", () => {
    render(<NotificationSoundToggle sound={sound({ isBlocked: true })} />);

    fireEvent.click(screen.getByRole("button", { name: "알림음이 꺼져 있습니다. 눌러서 켜기" }));

    expect(enableSoundMock).toHaveBeenCalled();
  });

  it("shows a mute toggle when sound is enabled and unmuted", () => {
    render(<NotificationSoundToggle sound={sound({ isBlocked: false, isMuted: false })} />);

    fireEvent.click(screen.getByRole("button", { name: "알림음 끄기" }));

    expect(toggleMutedMock).toHaveBeenCalled();
  });

  it("shows an unmute toggle when sound is muted", () => {
    render(<NotificationSoundToggle sound={sound({ isBlocked: false, isMuted: true })} />);

    expect(screen.getByRole("button", { name: "알림음 켜기" })).toBeInTheDocument();
  });
});
