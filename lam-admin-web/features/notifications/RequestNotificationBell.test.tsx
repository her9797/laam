import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RequestNotification } from "./model";

// See the same finding documented in `features/settings/ThemeMenu.test.tsx`
// and the old `NotificationBell.test.tsx`: the real `DropdownMenu`'s
// floating-ui positioning hangs jsdom. Replaced with plain always-rendered
// elements; real open/close/positioning is left to the Playwright e2e suite.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children, ...props }: ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const useRequestNotificationsMock = vi.fn();
vi.mock("./useRequestNotifications", () => ({
  useRequestNotifications: () => useRequestNotificationsMock(),
}));

// Covered on its own in useRequestBroadcast.test.tsx — mocked here as a
// no-op so this file doesn't need a real QueryClientProvider.
vi.mock("./useRequestBroadcast", () => ({
  useRequestBroadcast: () => {},
}));

const toastAddMock = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: { add: (...args: unknown[]) => toastAddMock(...args) },
}));

const singleMutateMock = vi.fn();
const bulkMutateMock = vi.fn();
vi.mock("@/features/requests/queries", () => ({
  useUpdateCustomerRequestStatusMutation: () => ({
    mutate: singleMutateMock,
    isPending: false,
    variables: undefined,
  }),
  useUpdateCustomerRequestStatusesMutation: () => ({
    mutate: bulkMutateMock,
    isPending: false,
  }),
}));

import "@/i18n/client";

import { RequestNotificationBell } from "./RequestNotificationBell";

const R1: RequestNotification = {
  id: "r1",
  kind: "general",
  tableNumber: "3",
  preview: "물 좀 주세요",
  createdAt: "2026-09-04T10:05:00Z",
};
const R2: RequestNotification = {
  id: "r2",
  kind: "song",
  tableNumber: "5",
  preview: "아무 노래",
  createdAt: "2026-09-04T10:01:00Z",
};
const NOTIFICATIONS: RequestNotification[] = [R1, R2];

function mockNotifications(notifications: RequestNotification[]) {
  useRequestNotificationsMock.mockReturnValue({
    notifications,
    count: notifications.length,
    isLoading: false,
    isError: false,
  });
}

const playChimeMock = vi.fn();

describe("RequestNotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the pending count as a badge and in the trigger's accessible name", () => {
    mockNotifications(NOTIFICATIONS);
    render(<RequestNotificationBell playChime={playChimeMock} />);

    expect(screen.getByRole("button", { name: /2/ })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows no numeric badge when there is nothing pending", () => {
    mockNotifications([]);
    render(<RequestNotificationBell playChime={playChimeMock} />);

    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing is pending", () => {
    mockNotifications([]);
    render(<RequestNotificationBell playChime={playChimeMock} />);

    expect(screen.getByText("확인하지 않은 요청이 없습니다.")).toBeInTheDocument();
  });

  it("clicking a general notification marks it checked and navigates to /requests", () => {
    mockNotifications(NOTIFICATIONS);
    render(<RequestNotificationBell playChime={playChimeMock} />);

    fireEvent.click(screen.getByRole("button", { name: /물 좀 주세요/ }));

    expect(singleMutateMock).toHaveBeenCalledWith({ id: "r1", status: "checked" });
    expect(pushMock).toHaveBeenCalledWith("/requests");
  });

  it("clicking a song notification keeps it pending and navigates to explicit approval", () => {
    mockNotifications(NOTIFICATIONS);
    render(<RequestNotificationBell playChime={playChimeMock} />);

    fireEvent.click(screen.getByRole("button", { name: /아무 노래/ }));

    expect(singleMutateMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/song-requests");
  });

  it("'모두 확인' asks for confirmation and bulk-checks only general requests", async () => {
    mockNotifications(NOTIFICATIONS);
    render(<RequestNotificationBell playChime={playChimeMock} />);

    fireEvent.click(screen.getByRole("button", { name: "모두 확인" }));
    expect(bulkMutateMock).not.toHaveBeenCalled();

    expect(await screen.findByText("모두 확인 처리할까요?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(bulkMutateMock).toHaveBeenCalledWith({ ids: ["r1"], status: "checked" });
  });

  it("does not show the bulk-check action when only song approvals are pending", () => {
    mockNotifications([R2]);
    render(<RequestNotificationBell playChime={playChimeMock} />);

    expect(screen.queryByRole("button", { name: "모두 확인" })).not.toBeInTheDocument();
  });

  it("shows an error message when the notifications query fails", () => {
    useRequestNotificationsMock.mockReturnValue({
      notifications: [],
      count: 0,
      isLoading: false,
      isError: true,
    });
    render(<RequestNotificationBell playChime={playChimeMock} />);

    expect(screen.getByRole("alert")).toHaveTextContent("알림을 불러오지 못했습니다.");
  });

  it("toasts once when a new request arrives after the initial load, but not for the initial baseline", () => {
    mockNotifications([R1]);
    const { rerender } = render(<RequestNotificationBell playChime={playChimeMock} />);
    expect(toastAddMock).not.toHaveBeenCalled();

    mockNotifications([R1, R2]);
    rerender(<RequestNotificationBell playChime={playChimeMock} />);

    expect(toastAddMock).toHaveBeenCalledTimes(1);
    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: "5번 테이블 노래 신청: 아무 노래" }),
    );
  });

  it("does not toast again on a re-render that reports the same data", () => {
    mockNotifications([R1]);
    const { rerender } = render(<RequestNotificationBell playChime={playChimeMock} />);

    mockNotifications([R1, R2]);
    rerender(<RequestNotificationBell playChime={playChimeMock} />);
    expect(toastAddMock).toHaveBeenCalledTimes(1);

    rerender(<RequestNotificationBell playChime={playChimeMock} />);

    expect(toastAddMock).toHaveBeenCalledTimes(1);
  });

  it("plays the chime once per arrival batch, even when several requests arrive together", () => {
    mockNotifications([R1]);
    const { rerender } = render(<RequestNotificationBell playChime={playChimeMock} />);
    expect(playChimeMock).not.toHaveBeenCalled();

    mockNotifications([R1, R2]);
    rerender(<RequestNotificationBell playChime={playChimeMock} />);

    expect(playChimeMock).toHaveBeenCalledTimes(1);
  });
});
