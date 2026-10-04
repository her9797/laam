import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let currentPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
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
}));

vi.mock("@/features/notifications/NotificationBells", () => ({
  NotificationBells: () => <button type="button">알림</button>,
}));

vi.mock("@/components/ui/toast", () => ({ toast: { add: vi.fn() } }));

// The real base-ui menu/tooltip hang jsdom once opened (floating-ui anchor
// positioning; see LanguageMenu.test.tsx). These stand-ins keep only the
// open/close state and the `render` prop wiring so the shell's own logic is
// what gets tested; the real popups are left to the browser.
function renderAs(
  render: React.ReactElement | undefined,
  props: Record<string, unknown>,
  children: React.ReactNode,
) {
  return render ? (
    React.cloneElement(render, props, children)
  ) : (
    <button {...props}>{children}</button>
  );
}

const MenuContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
  open: false,
  setOpen: () => {},
});

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => {
    const [open, setOpen] = React.useState(false);
    return <MenuContext.Provider value={{ open, setOpen }}>{children}</MenuContext.Provider>;
  },
  DropdownMenuTrigger: ({
    render,
    children,
    ...props
  }: { render?: React.ReactElement; children?: React.ReactNode } & Record<string, unknown>) => {
    const menu = React.useContext(MenuContext);
    return renderAs(
      render,
      { ...props, "aria-haspopup": "menu", onClick: () => menu.setOpen(!menu.open) },
      children,
    );
  },
  DropdownMenuContent: ({
    children,
    side,
    align,
  }: {
    children?: React.ReactNode;
    side?: string;
    align?: string;
  }) => {
    const menu = React.useContext(MenuContext);
    return menu.open ? (
      <div role="menu" data-side={side} data-align={align}>
        {children}
      </div>
    ) : null;
  },
  DropdownMenuGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    render,
    children,
    onClick,
    ...props
  }: { render?: React.ReactElement; children?: React.ReactNode } & Record<string, unknown> & {
      onClick?: (event: unknown) => void;
    }) => {
    const menu = React.useContext(MenuContext);
    return renderAs(
      render,
      {
        ...props,
        role: "menuitem",
        onClick: (event: unknown) => {
          onClick?.(event);
          menu.setOpen(false);
        },
      },
      children,
    );
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    render,
    children,
    ...props
  }: { render?: React.ReactElement; children?: React.ReactNode } & Record<string, unknown>) =>
    renderAs(render, props, children),
  TooltipContent: ({ children, hidden }: { children?: React.ReactNode; hidden?: boolean }) => (
    <div role="tooltip" hidden={hidden}>
      {children}
    </div>
  ),
  TooltipProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import i18n from "@/i18n/client";

import { AdminShell } from "./AdminShell";

function renderShell() {
  return render(
    <AdminShell>
      <p>page content</p>
    </AdminShell>,
  );
}

function collapseSidebar() {
  fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
  expect(document.querySelector('[data-slot="sidebar"]')).toHaveAttribute("data-state", "collapsed");
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

function getBreadcrumb() {
  return screen.getByRole("navigation", { name: "breadcrumb" });
}

function getCrumbTexts() {
  return within(getBreadcrumb())
    .getAllByRole("listitem")
    .filter((li) => li.textContent !== "/")
    .map((li) => li.textContent);
}

function getSectionLabels(nav: HTMLElement) {
  return Array.from(nav.querySelectorAll('[data-slot="sidebar-group-label"]')).map(
    (element) => element.textContent,
  );
}

describe("AdminShell navigation", () => {
  beforeEach(async () => {
    currentPathname = "/dashboard";
    window.localStorage.clear();
    document.cookie = "sidebar_width=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    setViewportWidth(1024);
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await i18n.changeLanguage("ko");
  });

  afterEach(() => {
    cleanup();
  });

  describe("접힌 사이드바의 그룹 플라이아웃", () => {
    it("그룹 버튼을 누르면 오른쪽에 2단계 메뉴가 열리고 현재 항목이 표시된다", () => {
      currentPathname = "/song-requests";
      renderShell();
      collapseSidebar();

      fireEvent.click(screen.getByRole("button", { name: "요청 관리" }));

      const menu = screen.getByRole("menu");
      expect(menu).toHaveAttribute("data-side", "right");
      expect(menu).toHaveAttribute("data-align", "start");
      const items = within(menu).getAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual(["손님 요청", "노래 신청", "특별 요청"]);
      expect(items.map((item) => item.getAttribute("href"))).toEqual([
        "/requests",
        "/song-requests",
        "/special-requests",
      ]);
      expect(items[1]).toHaveAttribute("aria-current", "page");
      expect(items[0]).not.toHaveAttribute("aria-current");
    });

    it("항목을 고르면 플라이아웃이 닫힌다", () => {
      renderShell();
      collapseSidebar();
      fireEvent.click(screen.getByRole("button", { name: "상품 관리" }));

      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "메뉴 관리" }));

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("펼친 사이드바에서는 플라이아웃 없이 기존 아코디언으로 동작한다", () => {
      renderShell();

      fireEvent.click(screen.getByRole("button", { name: "요청 관리" }));

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "손님 요청" })).toBeInTheDocument();
    });

    it("모바일 시트에서는 플라이아웃 없이 기존 아코디언으로 동작한다", () => {
      setViewportWidth(375);
      renderShell();
      fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
      const dialog = screen.getByRole("dialog");

      fireEvent.click(within(dialog).getByRole("button", { name: "요청 관리" }));

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(within(dialog).getByRole("link", { name: "손님 요청" })).toBeInTheDocument();
    });
  });

  describe("접힌 사이드바 툴팁", () => {
    it("접힌 상태에서 최상위 링크와 그룹 버튼의 이름이 툴팁으로 노출된다", () => {
      renderShell();
      collapseSidebar();

      for (const label of ["대시보드", "주문 관리", "매장 플레이어", "재고·지출", "시스템 로그"]) {
        expect(screen.getByRole("tooltip", { name: label })).toBeInTheDocument();
      }
    });

    it("펼친 상태에서는 툴팁이 노출되지 않는다", () => {
      renderShell();

      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  describe("브레드크럼", () => {
    it("그룹에 속한 항목은 홈 / 그룹 / 항목으로 표시한다", () => {
      currentPathname = "/orders/stats";
      renderShell();

      const breadcrumb = getBreadcrumb();
      expect(getCrumbTexts()).toEqual(["홈", "주문 관리", "매출 통계"]);
      expect(within(breadcrumb).getByText("주문 관리")).not.toHaveAttribute("aria-current");
      expect(within(breadcrumb).queryByRole("link", { name: "주문 관리" })).not.toBeInTheDocument();
      expect(within(breadcrumb).getByText("매출 통계")).toHaveAttribute("aria-current", "page");
      expect(within(breadcrumb).getByRole("link", { name: "홈" })).toHaveAttribute(
        "href",
        "/dashboard",
      );
    });

    it("최상위 항목은 홈 / 항목으로 표시한다", () => {
      currentPathname = "/player";
      renderShell();

      expect(getCrumbTexts()).toEqual(["홈", "매장 플레이어"]);
      expect(within(getBreadcrumb()).getByText("매장 플레이어")).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("대시보드에서는 홈 / 대시보드로 표시한다", () => {
      renderShell();

      expect(getCrumbTexts()).toEqual(["홈", "대시보드"]);
    });
  });

  describe("메뉴 배치", () => {
    it("섹션 구분 없이 하나의 목록에 기존 순서대로 메뉴를 그린다", () => {
      renderShell();

      const nav = screen.getByRole("navigation", { name: "주 메뉴" });
      expect(getSectionLabels(nav)).toEqual([]);
      expect(nav.querySelector('[data-slot="sidebar-separator"]')).toBeNull();

      const buttons = Array.from(nav.querySelectorAll('[data-slot="sidebar-menu-button"]')).map(
        (element) => element.textContent,
      );
      expect(buttons).toEqual([
        "대시보드",
        "매장 플레이어",
        "요청 관리",
        "주문 관리",
        "상품 관리",
        "재고·지출",
        "테이블 관리",
        "이벤트·공지",
        "쿠폰 관리",
        "안내 문구",
        "시스템 로그",
      ]);
    });
  });
});
