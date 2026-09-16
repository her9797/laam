import { expect, test, type Page } from "@playwright/test";

import type { CustomerRequest } from "@/features/requests/model";

import { loginAsAdmin, mockDashboardData } from "./fixtures";

// `components/ui/button.tsx` nudges a pressed button down 1px
// (`active:...:translate-y-px`). The pagination nav scrolls horizontally as
// a narrow-screen fallback, and `overflow-x: auto` computes `overflow-y` to
// `auto` as well — so that 1px pushed the 32px buttons past the 32px-tall
// nav and a vertical scrollbar flashed on every click. Layout can't be
// measured in jsdom, so this runs in a real browser.

const REQUEST_COUNT = 100;

function buildManyRequests(): CustomerRequest[] {
  return Array.from({ length: REQUEST_COUNT }, (_, index) => ({
    id: `r${index + 1}`,
    tableNumber: String((index % 9) + 1),
    text: `요청 ${index + 1}`,
    status: "pending",
    createdAt: new Date(Date.UTC(2026, 8, 3, 10, index)).toISOString(),
  }));
}

/** Paged `/api/admin/customer-requests?...` mock that actually slices pages. */
async function mockPagedRequests(page: Page, requests: CustomerRequest[]) {
  await page.route(
    (url) => url.pathname === "/api/admin/customer-requests" && url.search !== "",
    async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const pageNumber = Number(params.get("page")) || 1;
      const pageSize = Number(params.get("pageSize")) || 20;
      const start = (pageNumber - 1) * pageSize;
      await route.fulfill({
        json: {
          items: requests.slice(start, start + pageSize),
          page: pageNumber,
          pageSize,
          total: requests.length,
        },
      });
    },
  );
}

async function openRequests(page: Page) {
  await mockDashboardData(page);
  await loginAsAdmin(page);
  await mockPagedRequests(page, buildManyRequests());
  await page.goto("/requests");
  const nav = page.getByRole("navigation", { name: "페이지 탐색" });
  await expect(nav.getByRole("button", { name: "2페이지" })).toBeVisible();
  return nav;
}

function navOverflow(nav: ReturnType<Page["getByRole"]>) {
  return nav.evaluate((element) => {
    const { overflowY } = getComputedStyle(element);
    return {
      overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      // `scrollHeight` still counts the pressed 1px under `overflow-y: hidden`,
      // so what matters is whether that overflow is exposed as a scroll area.
      scrollsVertically:
        element.scrollHeight > element.clientHeight && (overflowY === "auto" || overflowY === "scroll"),
    };
  });
}

for (const width of [1280, 320]) {
  test(`pressing a page button does not make the pagination nav scroll vertically (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    const nav = await openRequests(page);

    for (const target of ["2페이지", "3페이지", "다음", "이전"]) {
      const button = nav.getByRole("button", { name: target });
      await button.scrollIntoViewIfNeeded();
      await button.hover();
      await page.mouse.down();
      // Let `transition-all` finish moving the pressed button.
      await page.waitForTimeout(300);
      const pressed = await navOverflow(nav);
      await page.mouse.up();

      expect(
        pressed.scrollsVertically,
        `nav scrolls vertically while pressing ${target}: ${JSON.stringify(pressed)}`,
      ).toBe(false);
      await expect(nav.locator('[aria-current="page"]')).toBeVisible();
    }
  });
}
