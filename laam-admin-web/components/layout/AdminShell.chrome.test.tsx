import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const refreshMock = vi.fn();
const currentPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
}));

vi.mock(
  "next/link",
  () => ({
    default: ({
      href,
      children,
      onClick,
      ...props
    }: React.ComponentProps<"a"> & { href: string }) => (
      <a
        href={href}
        {...props}
        onClick={(event) => {
          onClick?.(event);
          event.preventDefault();
        }}
      >
        {children}
      </a>
    ),
  }),
);

// The bell needs a QueryClientProvider; its behavior is covered elsewhere.
vi.mock("@/features/notifications/NotificationBells", () => ({
  NotificationBells: () => <button type="button">알림</button>,
}));

const toastAddMock = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: { add: (...args: unknown[]) => toastAddMock(...args) },
}));

import i18n from "@/i18n/client";

import { AdminShell } from "./AdminShell";

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

function getSlot(slot: string) {
  const el = document.querySelector(`[data-slot="${slot}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`${slot} not found`);
  }
  return el;
}

function renderShell() {
  return render(
    <AdminShell>
      <p>page content</p>
    </AdminShell>,
  );
}

describe("AdminShell sidebar header/footer", () => {
  beforeEach(async () => {
    replaceMock.mockClear();
    refreshMock.mockClear();
    toastAddMock.mockClear();
    window.localStorage.clear();
    document.cookie = "sidebar_width=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    setViewportWidth(1024);
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await i18n.changeLanguage("ko");
  });

  afterEach(() => {
    cleanup();
  });

  it("람 로고는 대시보드로 가는 링크이고 접근 가능한 이름이 하나뿐이다", () => {
    renderShell();

    const header = getSlot("sidebar-header");
    const link = within(header).getByRole("link", { name: "LAM 관리자" });
    expect(link).toHaveAttribute("href", "/dashboard");
    expect(link.querySelector("img")?.getAttribute("src")).toContain("logo.png");
    expect(within(header).getAllByLabelText("LAM 관리자")).toHaveLength(1);
  });

  it("모바일에서 로고를 누르면 사이드 시트가 닫힌다", async () => {
    setViewportWidth(375);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "LAM 관리자" }));

    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("로그아웃은 아이콘과 라벨을 가진 사이드바 메뉴 버튼이다", () => {
    renderShell();

    const button = within(getSlot("sidebar-footer")).getByRole("button", { name: "로그아웃" });
    expect(button).toHaveAttribute("data-slot", "sidebar-menu-button");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.querySelector("span")?.textContent).toBe("로그아웃");
  });

  it("접힌 상태에서도 로그아웃 버튼은 '로그아웃' 이름을 유지한다", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(getSlot("sidebar")).toHaveAttribute("data-state", "collapsed");

    expect(within(getSlot("sidebar-footer")).getByRole("button", { name: "로그아웃" })).toBeEnabled();
  });

  it("로그아웃 중에는 비활성화되고 '로그아웃 중' 라벨을 보여 준다", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    global.fetch = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderShell();

    fireEvent.click(within(getSlot("sidebar-footer")).getByRole("button", { name: "로그아웃" }));

    const pending = await within(getSlot("sidebar-footer")).findByRole("button", { name: /로그아웃 중/ });
    expect(pending).toBeDisabled();
    resolveFetch(new Response(JSON.stringify({ ok: true })));
    await vi.waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login"));
  });
});
