import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real `DropdownMenu` (ported from the design system in Task 1) is a
// `@base-ui/react` menu built on floating-ui anchor positioning. Opening it
// for real triggers floating-ui's positioning/observer machinery, which
// jsdom's zero-size mock layout cannot satisfy — that combination hangs the
// test worker indefinitely (verified directly against the raw primitive
// during this fix; not fixable by polyfilling ResizeObserver/
// IntersectionObserver/getBoundingClientRect, and not something this task
// may modify since the primitive itself is a vendored port, not project
// code). So this file replaces only the chrome (open/close/positioning)
// with plain, always-rendered elements and keeps `ThemeMenu`'s own real
// implementation and wiring under test. The real `DropdownMenu` interaction
// (opening via click, closing on selection, focus management) is left to
// the Playwright e2e suite (Task 8), which runs in a real browser.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuTrigger: ({
    children,
    ...props
  }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    ...props
  }: React.ComponentProps<"div">) => (
    <div role="menuitem" tabIndex={0} {...props}>
      {children}
    </div>
  ),
}));

// Side-effect import: initializes the shared i18next singleton so
// `useTranslation()` resolves real Korean copy instead of raw keys.
import "@/i18n/client";

import { ThemeMenu } from "./ThemeMenu";
import { ThemeProvider } from "./ThemeProvider";
import { THEME_STORAGE_KEY } from "./theme";

describe("ThemeMenu", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes the current theme via an icon-only trigger's accessible name", () => {
    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>,
    );

    const trigger = screen.getByRole("button", { name: /테마: 시스템/ });
    // Icon-only trigger: the theme is conveyed via aria-label and the icon,
    // not visible text (matches the reference design's icon-based header).
    expect(trigger).toHaveTextContent("");
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("labels the dropdown content with a '테마' heading", () => {
    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>,
    );

    expect(screen.getByText("테마")).toBeInTheDocument();
  });

  it("wires the 라이트 (light) menu item to setTheme(\"light\")", () => {
    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "라이트" }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("wires the 다크 (dark) menu item to setTheme(\"dark\")", () => {
    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "다크" }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("wires the 시스템 (system) menu item to setTheme(\"system\")", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "시스템" }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });
});
