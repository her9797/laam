import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderNotification } from "./model";

// See the same finding documented in `features/settings/ThemeMenu.test.tsx`
// and the old `NotificationBell.test.tsx`.
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

const useOrderNotificationsMock = vi.fn();
vi.mock("./useOrderNotifications", () => ({
  useOrderNotifications: () => useOrderNotificationsMock(),
}));

// Covered on its own in useOrderBroadcast.test.tsx — mocked here as a
// no-op so this file doesn't need a real QueryClientProvider.
vi.mock("./useOrderBroadcast", () => ({
  useOrderBroadcast: () => {},
}));

const toastAddMock = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: { add: (...args: unknown[]) => toastAddMock(...args) },
}));

import "@/i18n/client";

import { OrderNotificationBell } from "./OrderNotificationBell";

const O1: OrderNotification = {
  id: "o1",
  tableNumber: "7",
  menuItemName: "하우스 하이볼",
  amount: 10000,
  approvedAt: "2026-09-04T10:00:30Z",
};
const O2: OrderNotification = {
  id: "o2",
  tableNumber: "2",
  menuItemName: "진토닉",
  amount: 9000,
  approvedAt: "2026-09-04T10:02:00Z",
};

const dismissOrderMock = vi.fn();
function mockOrderNotifications(notifications: OrderNotification[]) {
  useOrderNotificationsMock.mockReturnValue({
    notifications,
    count: notifications.length,
    isLoading: false,
    dismiss: dismissOrderMock,
  });
}

const playChimeMock = vi.fn();

describe("OrderNotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("toasts and chimes once when a payment completes after the initial load", () => {
    mockOrderNotifications([O1]);
    const { rerender } = render(<OrderNotificationBell playChime={playChimeMock} />);
    expect(toastAddMock).not.toHaveBeenCalled();
    expect(playChimeMock).not.toHaveBeenCalled();

    mockOrderNotifications([O2, O1]);
    rerender(<OrderNotificationBell playChime={playChimeMock} />);

    expect(toastAddMock).toHaveBeenCalledTimes(1);
    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "새 주문이 들어왔습니다.",
        description: "2번 테이블 · 진토닉 · ₩9,000",
      }),
    );
    expect(playChimeMock).toHaveBeenCalledTimes(1);
  });

  it("does not toast for the paid orders already present on the initial load", () => {
    mockOrderNotifications([O1, O2]);
    const { rerender } = render(<OrderNotificationBell playChime={playChimeMock} />);

    rerender(<OrderNotificationBell playChime={playChimeMock} />);

    expect(toastAddMock).not.toHaveBeenCalled();
  });

  it("lists undismissed orders in the panel and shows the count on the badge", () => {
    mockOrderNotifications([O1, O2]);
    render(<OrderNotificationBell playChime={playChimeMock} />);

    expect(screen.getByRole("button", { name: "새 주문 알림 2건" })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("7 · 하우스 하이볼 · ₩10,000")).toBeInTheDocument();
    expect(screen.getByText("2 · 진토닉 · ₩9,000")).toBeInTheDocument();
  });

  it("shows the empty state when there are no undismissed orders", () => {
    mockOrderNotifications([]);
    render(<OrderNotificationBell playChime={playChimeMock} />);

    expect(screen.getByText("새로 들어온 주문이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("clicking an order in the panel dismisses it and navigates to /orders", () => {
    mockOrderNotifications([O1]);
    render(<OrderNotificationBell playChime={playChimeMock} />);

    fireEvent.click(screen.getByText("7 · 하우스 하이볼 · ₩10,000"));

    expect(dismissOrderMock).toHaveBeenCalledWith("o1");
    expect(pushMock).toHaveBeenCalledWith("/orders");
  });
});
