import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  buildCustomerRequests,
  buildPaymentOrders,
  buildSpecialRequests,
  buildSystemLogs,
  loginAsAdmin,
  mockCustomerRequestsPage,
  mockDashboardData,
  mockPaymentOrdersPage,
  mockSpecialRequestsPage,
  mockSystemLogsPage,
} from "./fixtures";

// `components/ui/table.tsx` renders `w-full table-fixed`, so on a narrow
// container the fixed-width (`w-20` etc.) columns claim their widths first
// and any `%`/auto column is squeezed to 0px. Layout can't be measured in
// jsdom, so these checks run in a real browser.

const MIN_COLUMN_WIDTH = 64;
const MIN_PRIMARY_COLUMN_WIDTH = 160;
// Layout settles within a few frames of the rows attaching; a longer wait
// would only delay reporting a genuinely collapsed column.
const LAYOUT_SETTLE_TIMEOUT = 5_000;

type ListScreen = {
  name: string;
  path: string;
  /** Registers this screen's list mocks (after `mockDashboardData`). */
  mock: (page: Page) => Promise<void>;
  /** Header indexes of the columns that used to collapse to 0px. */
  primaryColumns: number[];
};

const screens: ListScreen[] = [
  { name: "메뉴 관리", path: "/menu", mock: async () => {}, primaryColumns: [1] },
  {
    name: "카테고리 관리",
    path: "/menu/categories",
    mock: async () => {},
    primaryColumns: [1],
  },
  { name: "공지 관리", path: "/notices", mock: async () => {}, primaryColumns: [0] },
  {
    name: "주문 목록",
    path: "/orders",
    mock: (page) => mockPaymentOrdersPage(page, buildPaymentOrders()),
    primaryColumns: [2, 3],
  },
  {
    name: "일반 요청",
    path: "/requests",
    mock: (page) => mockCustomerRequestsPage(page, { requests: buildCustomerRequests() }),
    primaryColumns: [2],
  },
  {
    name: "특별 요청",
    path: "/special-requests",
    mock: (page) => mockSpecialRequestsPage(page, { requests: buildSpecialRequests() }),
    primaryColumns: [2],
  },
  {
    name: "시스템 로그",
    path: "/system-logs",
    mock: (page) => mockSystemLogsPage(page, buildSystemLogs()),
    primaryColumns: [3],
  },
];

type DesktopLayout = {
  name: string;
  width: number;
  height: number;
  /** Persisted sidebar width (`sidebar_width` cookie, `components/ui/sidebar.tsx`). */
  sidebarWidth?: number;
};

const desktopLayouts: DesktopLayout[] = [
  { name: "1280px 기본 사이드바", width: 1280, height: 800 },
  { name: "1440px 기본 사이드바", width: 1440, height: 900 },
  { name: "1440px 최대 사이드바", width: 1440, height: 900, sidebarWidth: 320 },
];

async function openListTable(page: Page, screen: ListScreen) {
  await mockDashboardData(page);
  await loginAsAdmin(page);
  await screen.mock(page);
  await page.goto(screen.path);

  const table = page.locator('[data-slot="table"]');
  // `attached`, not visible: a collapsed column would fail visibility for the
  // wrong reason before the width assertions below could report it.
  await table.locator('[data-slot="table-body"] tr').first().waitFor({ state: "attached" });
  await expect(table).toHaveCount(1);
  return table;
}

async function expectReadableColumns(table: Locator, screen: ListScreen) {
  const widths = await table
    .locator('[data-slot="table-head"]')
    .evaluateAll((heads) => heads.map((head) => head.getBoundingClientRect().width));

  expect(widths.length).toBeGreaterThan(0);
  widths.forEach((width, index) => {
    expect(width, `열 ${index} 너비`).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
  });
  for (const index of screen.primaryColumns) {
    expect(widths[index], `핵심 열 ${index} 너비`).toBeGreaterThanOrEqual(
      MIN_PRIMARY_COLUMN_WIDTH,
    );
  }
}

test.describe("목록 표 열 너비", () => {
  for (const screen of screens) {
    test(`${screen.name}: 모바일 폭에서도 모든 열이 읽을 수 있는 너비를 갖는다`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const table = await openListTable(page, screen);

      // Retried: right after the rows attach the table can still be
      // mid-layout (a column briefly reads 0px), which is not the collapse
      // under test — a genuinely collapsed column still fails on timeout.
      await expect(() => expectReadableColumns(table, screen)).toPass({
        timeout: LAYOUT_SETTLE_TIMEOUT,
      });
    });

    for (const layout of desktopLayouts) {
      test(`${screen.name}: ${layout.name}에서는 표가 가로 스크롤되지 않는다`, async ({
        page,
        baseURL,
      }) => {
        await page.setViewportSize({ width: layout.width, height: layout.height });
        if (layout.sidebarWidth) {
          await page.context().addCookies([
            { name: "sidebar_width", value: String(layout.sidebarWidth), url: baseURL! },
          ]);
        }
        const table = await openListTable(page, screen);

        await expect(async () => {
          if (layout.sidebarWidth) {
            const sidebarWidth = await page
              .locator('[data-slot="sidebar-wrapper"]')
              .evaluate((element) => getComputedStyle(element).getPropertyValue("--sidebar-width"));
            expect(sidebarWidth.trim()).toBe(`${layout.sidebarWidth}px`);
          }

          const widths = await table.evaluate((element) => ({
            tableScroll: element.parentElement!.scrollWidth,
            tableClient: element.parentElement!.clientWidth,
            tableRight: element.parentElement!.getBoundingClientRect().right,
            pageScroll: document.documentElement.scrollWidth,
            pageClient: document.documentElement.clientWidth,
          }));
          expect(widths.tableScroll, "표 가로 스크롤 폭").toBeLessThanOrEqual(widths.tableClient);
          // A table min-width can also widen the flex content area itself, so
          // the container never scrolls but the whole page does — check that
          // the container still ends inside the viewport.
          expect(widths.tableRight, "표 컨테이너 오른쪽 끝").toBeLessThanOrEqual(widths.pageClient);
          expect(widths.pageScroll, "페이지 가로 스크롤 폭").toBeLessThanOrEqual(widths.pageClient);

          await expectReadableColumns(table, screen);
        }).toPass({ timeout: LAYOUT_SETTLE_TIMEOUT });
      });
    }
  }
});

