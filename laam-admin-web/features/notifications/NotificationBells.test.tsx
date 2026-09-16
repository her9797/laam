import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const playChimeMock = vi.fn();
const useNotificationSoundMock = vi.fn(() => ({
  isBlocked: false,
  isMuted: false,
  toggleMuted: vi.fn(),
  enableSound: vi.fn(),
  playChime: playChimeMock,
}));
vi.mock("./useNotificationSound", () => ({
  useNotificationSound: () => useNotificationSoundMock(),
}));

vi.mock("./NotificationSoundToggle", () => ({
  NotificationSoundToggle: () => <button type="button">sound-toggle</button>,
}));

let lastRequestBellPlayChime: (() => void) | undefined;
vi.mock("./RequestNotificationBell", () => ({
  RequestNotificationBell: ({ playChime }: { playChime: () => void }) => {
    lastRequestBellPlayChime = playChime;
    return <button type="button">request-bell</button>;
  },
}));

let lastOrderBellPlayChime: (() => void) | undefined;
vi.mock("./OrderNotificationBell", () => ({
  OrderNotificationBell: ({ playChime }: { playChime: () => void }) => {
    lastOrderBellPlayChime = playChime;
    return <button type="button">order-bell</button>;
  },
}));

import { NotificationBells } from "./NotificationBells";

describe("NotificationBells", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the shared sound toggle alongside both independent bells", () => {
    render(<NotificationBells />);

    expect(screen.getByRole("button", { name: "sound-toggle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "request-bell" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "order-bell" })).toBeInTheDocument();
  });

  it("passes the same single playChime instance to both bells", () => {
    render(<NotificationBells />);

    expect(lastRequestBellPlayChime).toBe(playChimeMock);
    expect(lastOrderBellPlayChime).toBe(playChimeMock);
  });
});
