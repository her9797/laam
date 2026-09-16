import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const refreshMock = vi.fn();
// Reassigned (followed by `rerender`) to simulate arriving on another route.
let currentPathname = "/dashboard";

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
          // Like the real `next/link`, keep the click client-side instead of
          // letting jsdom attempt (and report as unimplemented) a page load.
          event.preventDefault();
        }}
      >
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

// The real `<Toaster />` lives in `AppProviders`, which these renders don't
// include — assert on what the shell asks the toast manager to show instead.
const toastAddMock = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: { add: (...args: unknown[]) => toastAddMock(...args) },
}));

import i18n from "@/i18n/client";

import { AdminShell } from "./AdminShell";

const TOP_LEVEL_NAV_LABELS = ["대시보드", "매장 플레이어", "이벤트·공지", "안내 문구"];

const REQUEST_GROUP_SUB_LABELS = ["손님 요청", "노래 신청", "특별 요청"];

const PRODUCT_GROUP_SUB_LABELS = ["메뉴 관리", "카테고리 관리"];

const LOGOUT_FAILED_MESSAGE = "로그아웃하지 못했습니다. 다시 시도해 주세요.";

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
    toastAddMock.mockClear();
    currentPathname = "/dashboard";
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

    function expectReachableLink(label: string) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toBeInTheDocument();
      expect(link).not.toHaveAttribute("tabindex", "-1");
    }

    TOP_LEVEL_NAV_LABELS.forEach(expectReachableLink);

    // "손님 요청"/"노래 신청"/"특별 요청" sit behind the "요청 관리" dropdown
    // and "메뉴 관리"/"카테고리 관리" sit behind the "상품 관리" dropdown,
    // both closed by default here since the mocked pathname ("/dashboard")
    // isn't one of their routes. Only one dropdown is expanded at a time, so
    // each is opened right before checking the links nested under it.
    fireEvent.click(screen.getByRole("button", { name: "요청 관리" }));
    REQUEST_GROUP_SUB_LABELS.forEach(expectReachableLink);

    fireEvent.click(screen.getByRole("button", { name: "상품 관리" }));
    PRODUCT_GROUP_SUB_LABELS.forEach(expectReachableLink);
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
    expect(refreshMock).toHaveBeenCalled();
    expect(toastAddMock).not.toHaveBeenCalled();
  });

  it("stays on the page and shows a translated error toast when logout responds with a non-2xx status", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    await vi.waitFor(() => {
      expect(replaceMock).not.toHaveBeenCalled();
      expect(toastAddMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: LOGOUT_FAILED_MESSAGE }),
      );
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("stays on the page and shows a translated error toast when the logout request itself fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    await vi.waitFor(() => {
      expect(replaceMock).not.toHaveBeenCalled();
      expect(toastAddMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: LOGOUT_FAILED_MESSAGE }),
      );
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("re-enables the logout button after a failed attempt so a retry can log out", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(
      <AdminShell>
        <p>page content</p>
      </AdminShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "로그아웃" })).toBeEnabled();
    });
    expect(replaceMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    await vi.waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login");
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  describe("사이드바 메뉴 그룹", () => {
    it.each(["매장 플레이어", "시스템 로그"])(
      "그룹을 열어 둔 채 최상위 메뉴(%s)를 누르면 열려 있던 그룹이 닫힌다",
      (linkLabel) => {
        render(
          <AdminShell>
            <p>page content</p>
          </AdminShell>,
        );
        const requestGroup = screen.getByRole("button", { name: "요청 관리" });
        fireEvent.click(requestGroup);
        expect(requestGroup).toHaveAttribute("aria-expanded", "true");

        fireEvent.click(screen.getByRole("link", { name: linkLabel }));

        expect(requestGroup).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("link", { name: "손님 요청" })).not.toBeInTheDocument();
      },
    );

    it("다른 그룹을 열면 먼저 열려 있던 그룹은 닫혀 한 번에 하나만 열린다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const requestGroup = screen.getByRole("button", { name: "요청 관리" });
      const productGroup = screen.getByRole("button", { name: "상품 관리" });

      fireEvent.click(requestGroup);
      fireEvent.click(productGroup);

      expect(requestGroup).toHaveAttribute("aria-expanded", "false");
      expect(productGroup).toHaveAttribute("aria-expanded", "true");
      expect(screen.queryByRole("link", { name: "손님 요청" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "메뉴 관리" })).toBeInTheDocument();
    });

    it("현재 경로가 속해 자동으로 펼쳐진 그룹도 다른 그룹을 열면 닫힌다", () => {
      currentPathname = "/requests";
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const requestGroup = screen.getByRole("button", { name: "요청 관리" });
      const productGroup = screen.getByRole("button", { name: "상품 관리" });
      expect(requestGroup).toHaveAttribute("aria-expanded", "true");

      fireEvent.click(productGroup);

      expect(requestGroup).toHaveAttribute("aria-expanded", "false");
      expect(productGroup).toHaveAttribute("aria-expanded", "true");
    });

    it("현재 경로가 속한 그룹도 자기 토글 버튼으로 접을 수 있다", () => {
      currentPathname = "/requests";
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const requestGroup = screen.getByRole("button", { name: "요청 관리" });
      expect(requestGroup).toHaveAttribute("aria-expanded", "true");

      fireEvent.click(requestGroup);

      expect(requestGroup).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("link", { name: "손님 요청" })).not.toBeInTheDocument();
    });

    it("같은 그룹의 하위 메뉴를 누르면 그 그룹은 열린 채로 남는다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const productGroup = screen.getByRole("button", { name: "상품 관리" });
      fireEvent.click(productGroup);

      fireEvent.click(screen.getByRole("link", { name: "메뉴 관리" }));

      expect(productGroup).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("link", { name: "카테고리 관리" })).toBeInTheDocument();
    });

    it("다른 화면으로 이동하면 직접 열어 둔 그룹은 초기화되고 현재 경로가 속한 그룹만 열린다", () => {
      const { rerender } = render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      fireEvent.click(screen.getByRole("button", { name: "상품 관리" }));

      currentPathname = "/requests";
      rerender(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );

      expect(screen.getByRole("button", { name: "요청 관리" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "상품 관리" })).toHaveAttribute("aria-expanded", "false");

      // Returning to the screen the group was opened on doesn't restore that
      // earlier manual choice either.
      currentPathname = "/dashboard";
      rerender(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );

      expect(screen.getByRole("button", { name: "요청 관리" })).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByRole("button", { name: "상품 관리" })).toHaveAttribute("aria-expanded", "false");
    });

    it("데스크톱에서는 메뉴 링크를 눌러도 사이드바의 펼침·접힘 상태가 바뀌지 않는다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      const sidebar = document.querySelector('[data-slot="sidebar"]');
      expect(sidebar).toHaveAttribute("data-state", "expanded");

      fireEvent.click(screen.getByRole("link", { name: "매장 플레이어" }));
      expect(sidebar).toHaveAttribute("data-state", "expanded");

      fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
      expect(sidebar).toHaveAttribute("data-state", "collapsed");

      fireEvent.click(screen.getByRole("link", { name: "매장 플레이어" }));
      expect(sidebar).toHaveAttribute("data-state", "collapsed");
    });
  });

  describe("모바일 사이드 시트", () => {
    beforeEach(() => {
      setViewportWidth(375);
    });

    it("최상위 메뉴 링크를 누르면 사이드 시트가 닫힌다", async () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));

      fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "매장 플레이어" }));

      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("그룹의 하위 메뉴 링크를 누르면 사이드 시트가 닫힌다", async () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "상품 관리" }));

      fireEvent.click(within(dialog).getByRole("link", { name: "메뉴 관리" }));

      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("그룹 토글 버튼을 누르면 사이드 시트는 열린 채로 남는다", () => {
      render(
        <AdminShell>
          <p>page content</p>
        </AdminShell>,
      );
      fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));

      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "상품 관리" }));

      // A closing sheet drops out of the accessibility tree immediately, so
      // this lookup would already fail had the toggle dismissed it.
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("link", { name: "메뉴 관리" })).toBeInTheDocument();
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
