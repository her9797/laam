import { expect, test, type Locator, type Page } from "@playwright/test";

import { buildBillDetail, loginAsAdmin, mockBillDetail, mockDashboardData } from "./fixtures";

// Same check as `mobile-list-columns.spec.ts`, for 계산서 상세's two tables:
// `components/ui/table.tsx` renders `w-full table-fixed`, so without a table
// min-width a narrow screen squeezes every column until approval numbers,
// times and amounts break over several lines. Layout can't be measured in
// jsdom, so these checks run in a real browser.

const MIN_COLUMN_WIDTH = 64;
const MIN_PRIMARY_COLUMN_WIDTH = 160;
const LAYOUT_SETTLE_TIMEOUT = 5_000;

type BillTable = {
  /** Card title the table sits under. */
  title: string;
  /** Header indexes of the columns that must stay wide enough to read. */
  primaryColumns: number[];
};

const billTables: BillTable[] = [
  { title: "결제 내역", primaryColumns: [] },
  { title: "메뉴 내역", primaryColumns: [0] },
];

async function openBillDetail(page: Page) {
  const bill = buildBillDetail();
  await mockDashboardData(page);
  await loginAsAdmin(page);
  await mockBillDetail(page, bill);
  await page.goto(`/orders/bills/${bill.id}`);
  await expect(page.getByRole("heading", { name: "계산서 상세" })).toBeVisible();
}

function tableUnder(page: Page, title: string): Locator {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: title }) })
    .locator('[data-slot="table"]');
}

async function expectReadableColumns(table: Locator, billTable: BillTable) {
  const widths = await table
    .locator('[data-slot="table-head"]')
    .evaluateAll((heads) => heads.map((head) => head.getBoundingClientRect().width));

  expect(widths.length).toBeGreaterThan(0);
  widths.forEach((width, index) => {
    expect(width, `${billTable.title} 열 ${index} 너비`).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
  });
  for (const index of billTable.primaryColumns) {
    expect(widths[index], `${billTable.title} 핵심 열 ${index} 너비`).toBeGreaterThanOrEqual(
      MIN_PRIMARY_COLUMN_WIDTH,
    );
  }
}

type DesktopLayout = {
  name: string;
  width: number;
  height: number;
  /** Persisted sidebar width (`sidebar_width` cookie, `components/ui/sidebar.tsx`). */
  sidebarWidth?: number;
};

const desktopLayouts: DesktopLayout[] = [
  { name: "1280px 기본 사이드바", width: 1280, height: 800 },
  { name: "1440px 최대 사이드바", width: 1440, height: 900, sidebarWidth: 320 },
];

test.describe("계산서 상세 표 열 너비", () => {
  test("모바일 폭에서도 결제·메뉴 표의 모든 열이 읽을 수 있는 너비를 갖는다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBillDetail(page);

    for (const billTable of billTables) {
      const table = tableUnder(page, billTable.title);
      await expect(table).toHaveCount(1);
      await expect(() => expectReadableColumns(table, billTable)).toPass({
        timeout: LAYOUT_SETTLE_TIMEOUT,
      });
    }
  });

  for (const layout of desktopLayouts) {
    test(`${layout.name}에서는 결제·메뉴 표가 가로 스크롤되지 않는다`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      if (layout.sidebarWidth) {
        await page.context().addCookies([
          { name: "sidebar_width", value: String(layout.sidebarWidth), url: baseURL! },
        ]);
      }
      await openBillDetail(page);

      for (const billTable of billTables) {
        const table = tableUnder(page, billTable.title);
        await expect(table).toHaveCount(1);
        await expect(async () => {
          const widths = await table.evaluate((element) => ({
            tableScroll: element.parentElement!.scrollWidth,
            tableClient: element.parentElement!.clientWidth,
            tableRight: element.parentElement!.getBoundingClientRect().right,
            pageScroll: document.documentElement.scrollWidth,
            pageClient: document.documentElement.clientWidth,
          }));
          expect(widths.tableScroll, `${billTable.title} 표 가로 스크롤 폭`).toBeLessThanOrEqual(
            widths.tableClient,
          );
          expect(widths.tableRight, `${billTable.title} 표 컨테이너 오른쪽 끝`).toBeLessThanOrEqual(
            widths.pageClient,
          );
          expect(widths.pageScroll, "페이지 가로 스크롤 폭").toBeLessThanOrEqual(widths.pageClient);

          await expectReadableColumns(table, billTable);
        }).toPass({ timeout: LAYOUT_SETTLE_TIMEOUT });
      }
    });
  }
});
