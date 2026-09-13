import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
}));

vi.mock(
  "next/link",
  () => ({
    default: ({
      href,
      children,
      ...props
    }: React.ComponentProps<"a"> & { href: string }) => (
      <a href={href} {...props}>
        {children}
      </a>
    ),
  }),
);

// `NotificationBells` calls `useCustomerRequestsQuery()` (a real TanStack
// Query hook), which throws without a `QueryClientProvider` ancestor — one
// this file's many `render(<AdminShell>...)` call sites don't have, since
// nothing else here needs Query. Its own behavior (badge counts, panels,
// mark-checked, mark-all, toast, sound toggle) is already covered by
// `features/notifications/NotificationBells.test.tsx` and the two bells'
// own test files; this file's job is only to verify the shell places it
// in the header.
vi.mock("@/features/notifications/NotificationBells", () => ({
  NotificationBells: () => <button type="button">알림</button>,
}));

import i18n from "@/i18n/client";

import { AdminShell } from "./AdminShell";

const NAV_LABELS = [
  "대시보드",
  "매장 플레이어",
  "손님 요청",
  "노래 신청",
  "특별 요청",
  "메뉴 관리",
  "카테고리 관리",
  "이벤트·공지",
  "안내 문구",
];

const REQUEST_GROUP_SUB_LABELS = ["손님 요청", "노래 신청", "특별 요청"];

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

function getSidebarWrapper() {
  const wrapper = document.querySelector('[data-slot="sidebar-wrapper"]');
  if (!(wrapper instanceof HTMLElement)) {
    throw new Error("sidebar wrapper not found");
  }
  return wrapper;
}

function clearSidebarWidthCookie() {
  document.cookie = "sidebar_width=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

describe("AdminShell", () => {
  beforeEach(async () => {
    replaceMock.mockClear();
    refreshMock.mockClear();
    window.localStorage.clear();
    clearSidebarWidthCookie();
    setViewportWidth(1024);
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    // The language menu test switches the shared i18next singleton to "en";
    // reset it before every test so test order can't leak locale state.
    await i18n.changeLanguage("ko");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders every primary navigation item as a reachable link", () => {
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    // "손님 요청"/"노래 신청"/"특별 요청" sit behind the "요청 관리" dropdown
    // and "메뉴 관리"/"카테고리 관리" sit behind the "상품 관리" dropdown,
    // both closed by default here since the mocked pathname ("/dashboard")
    // isn't one of their routes — open them first so every item in
    // NAV_LABELS is reachable.
    fireEvent.click(screen.getByRole("button", { name: "요청 관리" }));
    fireEvent.click(screen.getByRole("button", { name: "상품 관리" }));

    for (const label of NAV_LABELS) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toBeInTheDocument();
      expect(link).not.toHaveAttribute("tabindex", "-1");
    }
  });

  it("exposes 상품 관리 as a collapsed dropdown that reveals its sub-links on click", () => {
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    const toggle = screen.getByRole("button", { name: "상품 관리" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "메뉴 관리" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "카테고리 관리" })).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "메뉴 관리" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "카테고리 관리" })).toBeInTheDocument();
  });

  it("exposes 요청 관리 as a collapsed dropdown that reveals its sub-links on click", () => {
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    const toggle = screen.getByRole("button", { name: "요청 관리" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    for (const label of REQUEST_GROUP_SUB_LABELS) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const label of REQUEST_GROUP_SUB_LABELS) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("renders the page content passed as children", () => {
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("renders main content with the id the root layout's skip link targets", () => {
    // The root layout (`app/layout.tsx`) renders the single global skip
    // link, targeting `#main-content`. AdminShell must not render its own
    // second skip link — it only needs to give `<main>` this matching id.
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    expect(
      screen.queryByRole("link", { name: "본문으로 바로가기" }),
    ).not.toBeInTheDocument();

    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main?.tagName).toBe("MAIN");
  });

  it("opens the mobile navigation via a keyboard-operable trigger button", () => {
    setViewportWidth(375);

    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    // On narrow viewports the sidebar is not in the document until opened.
    expect(screen.queryByRole("link", { name: "대시보드" })).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "메뉴 열기" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).not.toBeDisabled();

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "대시보드" })).toBeInTheDocument();
  });

  it("exposes a keyboard-operable language menu trigger", () => {
    // Opening the menu (base-ui `DropdownMenu`, floating-ui anchor
    // positioning) is not exercised here — see ThemeMenu.test.tsx /
    // LanguageMenu.test.tsx for the documented reason it can't run under
    // jsdom, and the wiring coverage for each option. This asserts the
    // shell composes a real, enabled, keyboard-reachable native button for
    // it (Enter/Space activation is native browser behavior).
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    const languageTrigger = screen.getByRole("button", { name: /언어:/ });
    expect(languageTrigger.tagName).toBe("BUTTON");
    expect(languageTrigger).not.toBeDisabled();
  });

  it("exposes a keyboard-operable theme menu trigger", () => {
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    const themeTrigger = screen.getByRole("button", { name: /테마:/ });
    expect(themeTrigger.tagName).toBe("BUTTON");
    expect(themeTrigger).not.toBeDisabled();
  });

  it("places the notification bell in the header alongside the language and theme menus", () => {
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    expect(screen.getByRole("button", { name: "알림" })).toBeInTheDocument();
  });

  it("logs out via a keyboard-operable button and redirects to the login page", async () => {
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    const logoutButton = screen.getByRole("button", { name: "로그아웃" });
    expect(logoutButton.tagName).toBe("BUTTON");

    fireEvent.click(logoutButton);

    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/admin-logout",
        expect.objectContaining({ method: "POST" }),
      );
      expect(replaceMock).toHaveBeenCalledWith("/login");
    });
  });

  describe("사이드바 폭 조절", () => {
    it("펼침 상태에서는 폭 조절 핸들이 노출된다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );

      expect(screen.getByRole("separator", { name: "Resize Sidebar" })).toBeInTheDocument();
    });

    it("아이콘만 보이는 축소 상태에서는 폭 조절 핸들이 사라진다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );

      fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));

      expect(screen.queryByRole("separator", { name: "Resize Sidebar" })).not.toBeInTheDocument();
    });

    it("마우스로 드래그하면 이동한 만큼 사이드바 폭이 늘어난다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const wrapper = getSidebarWrapper();
      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("256px");

      const handle = screen.getByRole("separator", { name: "Resize Sidebar" });
      fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1, pointerType: "mouse" });
      fireEvent.pointerMove(window, { clientX: 306, pointerId: 1, pointerType: "mouse" });
      fireEvent.pointerUp(window, { clientX: 306, pointerId: 1, pointerType: "mouse" });

      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("306px");
    });

    it("터치로 드래그해도 이동한 만큼 사이드바 폭이 늘어난다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const wrapper = getSidebarWrapper();
      const handle = screen.getByRole("separator", { name: "Resize Sidebar" });

      fireEvent.pointerDown(handle, { clientX: 256, pointerId: 2, pointerType: "touch" });
      fireEvent.pointerMove(window, { clientX: 316, pointerId: 2, pointerType: "touch" });
      fireEvent.pointerUp(window, { clientX: 316, pointerId: 2, pointerType: "touch" });

      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("316px");
    });

    it("최소 폭보다 작게 드래그하면 최소 폭(148px)으로 고정된다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const wrapper = getSidebarWrapper();
      const handle = screen.getByRole("separator", { name: "Resize Sidebar" });

      fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: -1000, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: -1000, pointerId: 1 });

      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("148px");
    });

    it("최대 폭보다 크게 드래그하면 최대 폭(320px)으로 고정된다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const wrapper = getSidebarWrapper();
      const handle = screen.getByRole("separator", { name: "Resize Sidebar" });

      fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 2000, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 2000, pointerId: 1 });

      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("320px");
    });

    it("드래그로 조절한 폭을 쿠키에 저장한다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const handle = screen.getByRole("separator", { name: "Resize Sidebar" });

      fireEvent.pointerDown(handle, { clientX: 256, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 300, pointerId: 1 });

      expect(document.cookie).toContain("sidebar_width=300");
    });

    it("쿠키에 저장된 폭으로 마운트 시 복원한다", () => {
      document.cookie = "sidebar_width=280; path=/";

      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );

      expect(getSidebarWrapper().style.getPropertyValue("--sidebar-width")).toBe("280px");
    });

    it("포커스 후 화살표/Home/End 키로 폭을 조절할 수 있다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const wrapper = getSidebarWrapper();
      const handle = screen.getByRole("separator", { name: "Resize Sidebar" });
      handle.focus();

      fireEvent.keyDown(handle, { key: "ArrowRight" });
      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("272px");

      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("256px");

      fireEvent.keyDown(handle, { key: "Home" });
      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("148px");

      fireEvent.keyDown(handle, { key: "End" });
      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("320px");
    });
  });
});
