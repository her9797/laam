import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// See the comment in ThemeMenu.test.tsx: the real ported `DropdownMenu` is a
// `@base-ui/react` menu whose floating-ui anchor positioning hangs the test
// worker indefinitely once opened in jsdom (verified directly against the
// raw primitive). This mock replaces only the open/close/positioning chrome
// with plain, always-rendered elements so `LanguageMenu`'s own real
// implementation and wiring can be tested; the real interactive dropdown is
// covered by the Playwright e2e suite (Task 8) instead.
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

import i18n from "@/i18n/client";

import { LanguageMenu } from "./LanguageMenu";

describe("LanguageMenu", () => {
  beforeEach(async () => {
    // The language menu changes the shared i18next singleton; reset it
    // before every test so test order can't leak locale state.
    await i18n.changeLanguage("ko");
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes the current language via an icon-only trigger's accessible name", () => {
    render(<LanguageMenu />);

    const trigger = screen.getByRole("button", { name: /언어: 한국어/ });
    // Icon-only trigger: the language is conveyed via aria-label and the
    // icon, not visible text (matches the reference design's icon-based
    // header).
    expect(trigger).toHaveTextContent("");
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("labels the dropdown content with a '언어' heading", () => {
    render(<LanguageMenu />);

    expect(screen.getByText("언어")).toBeInTheDocument();
  });

  it("wires the English menu item to i18n.changeLanguage(\"en\")", async () => {
    render(<LanguageMenu />);

    fireEvent.click(screen.getByRole("menuitem", { name: "영어" }));

    await vi.waitFor(() => {
      expect(i18n.resolvedLanguage).toBe("en");
    });
  });

  it("wires the Korean menu item to i18n.changeLanguage(\"ko\")", async () => {
    await i18n.changeLanguage("en");

    render(<LanguageMenu />);

    // The UI is currently rendered in English, so the Korean option's own
    // label is also shown translated ("Korean"), not as "한국어".
    fireEvent.click(screen.getByRole("menuitem", { name: "Korean" }));

    await vi.waitFor(() => {
      expect(i18n.resolvedLanguage).toBe("ko");
    });
  });
});
