import { expect, test } from "@playwright/test";

import { loginAsAdmin, mockDashboardData } from "./fixtures";

// Each test mocks its own dashboard data and logs in independently — no
// fixture or browser state (locale/theme are read from `localStorage`,
// which Playwright already scopes to one browser context per test) is
// shared with any other test in this file.

test.describe("설정과 모바일 내비게이션 회귀", () => {
  test("언어를 영어로 변경하면 새로고침 후에도 유지된다", async ({ page }) => {
    await mockDashboardData(page);
    await loginAsAdmin(page);

    // Scoped to the sidebar itself (`data-slot="sidebar"`, from
    // `components/ui/sidebar.tsx`) — the breadcrumb also links to
    // `/dashboard`, and the dashboard's own shortcut cards duplicate every
    // other nav label as link text, so an unscoped `getByRole("link", ...)`
    // would be ambiguous.
    const navDashboardLink = page
      .locator('[data-slot="sidebar"]')
      .getByRole("link", { name: /^(대시보드|Dashboard)$/ });
    await expect(navDashboardLink).toHaveText("대시보드");

    // The page's OWN copy, not just the shell — this is what the
    // whole-branch review found missing (i18n covered the shell only).
    const pageHeading = page.getByRole("heading", { level: 1 });
    const shortcutCard = page.locator("main").getByText(/^(확인이 필요한 일반 요청|General requests awaiting review)$/);
    await expect(pageHeading).toHaveText("대시보드");
    await expect(shortcutCard).toHaveText("확인이 필요한 일반 요청");

    await page.getByRole("button", { name: /언어:/ }).click();
    await page.getByRole("menuitem", { name: "영어" }).click();

    // The nav re-renders with `react-i18next`'s English resource bundle —
    // this is the user-visible effect of the language switch.
    await expect(navDashboardLink).toHaveText("Dashboard");
    await expect(page.getByRole("button", { name: /Language:/ })).toBeVisible();
    await expect(pageHeading).toHaveText("Dashboard");
    await expect(shortcutCard).toHaveText("General requests awaiting review");

    await page.reload();

    // `i18next-browser-languagedetector` caches the choice to `localStorage`
    // (`lam-admin.locale`) and reads it back on the next `i18n.init()`, so
    // the reloaded page renders in English again without re-selecting it.
    await expect(navDashboardLink).toHaveText("Dashboard");
    await expect(page.getByRole("button", { name: /Language:/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
    // Accessibility: screen readers rely on `<html lang>`, not just the
    // visible text, so the restored-from-storage locale must also update it
    // (per the design spec's "언어 변경 시 문서의 lang 속성도 갱신한다").
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("다크 테마를 선택하면 새로고침 후에도 유지된다", async ({ page }) => {
    await mockDashboardData(page);
    await loginAsAdmin(page);

    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: /테마:/ }).click();
    await page.getByRole("menuitem", { name: "다크" }).click();

    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.reload();

    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("시스템 테마를 선택하면 OS 다크 모드 설정이 새로고침 후에도 반영된다", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await mockDashboardData(page);
    await loginAsAdmin(page);

    await page.getByRole("button", { name: /테마:/ }).click();
    await page.getByRole("menuitem", { name: "시스템" }).click();

    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.reload();

    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("모바일 화면에서 사이드바를 열고 탐색한 뒤 닫을 수 있다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockDashboardData(page);
    await loginAsAdmin(page);

    // On a narrow viewport the sidebar (and its nav links) is not in the
    // document until the mobile sheet is opened (matches
    // `components/layout/AdminShell.test.tsx`'s same assertion). Scoped to
    // `[data-slot="sidebar"]` because the dashboard's own "메뉴 관리"
    // shortcut card is a same-named link that *is* visible here.
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);

    const trigger = page.getByRole("button", { name: "메뉴 열기" });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Keyboard operability: opening the sheet must move focus inside it,
    // not leave it stranded on a now-hidden trigger.
    const activeElementInDialog = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') !== null,
    );
    expect(activeElementInDialog).toBe(true);

    // "메뉴 관리" sits behind the "상품 관리" dropdown, collapsed by default
    // since the dashboard isn't one of its routes.
    await dialog.getByRole("button", { name: "상품 관리" }).click();
    await dialog.getByRole("link", { name: "메뉴 관리" }).click();
    await expect(page).toHaveURL(/\/menu$/);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    // Focus returns to the trigger that opened the sheet once it closes.
    await expect(trigger).toBeFocused();
  });
});
