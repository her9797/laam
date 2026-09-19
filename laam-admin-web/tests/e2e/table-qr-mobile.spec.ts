import { expect, test, type Page } from "@playwright/test";

import type { AdminTable, AdminTablesData, PosTable } from "@/features/tables/model";

import { loginAsAdmin, mockDashboardData } from "./fixtures";

// Every button on this screen keeps its label on one line and never shrinks
// (`components/ui/button.tsx`: `shrink-0 whitespace-nowrap`), and the QR
// preview is a fixed-size copy-link button, so a card narrower than its
// content pushes them into its padding or past its border — a 320px phone
// with two columns, or a 768–1024px window where the desktop sidebar leaves
// five columns only ~80–130px each. Layout can't be measured in jsdom, so
// these checks run in a real browser.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
];

/**
 * The 15-table layout the QR grid has always shown (B-01..05, T-01..10).
 * The first T table is left unlinked so the POS panel renders both row
 * states — linked and "needs linking" — plus its warning banner.
 */
function buildTables(): AdminTable[] {
  const buildTable = (area: AdminTable["area"], number: number): AdminTable => {
    const id = `${area}-${String(number).padStart(2, "0")}`;
    const linked = !(area === "T" && number === 1);
    return {
      id,
      area,
      number,
      qrUrl: `https://example.com/qr/enter?table=${id}&sig=e2e`,
      posTableId: linked ? 100 + number : null,
      posTableTitle: linked ? `${number}번 테이블` : null,
      hallName: linked ? "1층 홀" : null,
      linkedAt: linked ? "2026-09-19T00:00:00Z" : null,
    };
  };
  return [
    ...Array.from({ length: 5 }, (_, index) => buildTable("B", index + 1)),
    ...Array.from({ length: 10 }, (_, index) => buildTable("T", index + 1)),
  ];
}

/** One POS table with no QR table of its own, so the POS-only section has a row. */
function buildPosOnlyTables(): PosTable[] {
  return [
    {
      posTableId: 900,
      title: "룸1",
      hallId: 2,
      hallName: "2층 홀",
      capacity: 6,
      syncedAt: "2026-09-19T00:00:00Z",
      qrTableId: null,
    },
  ];
}

/** Mocks the table screen route (`GET /api/admin/tables`, see `features/tables/api.ts`). */
async function mockAdminTables(page: Page, tables: AdminTable[]): Promise<void> {
  const payload: AdminTablesData = {
    tables,
    posOnlyTables: buildPosOnlyTables(),
    lastSyncedAt: "2026-09-19T00:00:00Z",
    pendingSync: null,
  };
  await page.route("**/api/admin/tables", async (route) => {
    await route.fulfill({ json: payload });
  });
}

/**
 * Runs in the browser: describes every button inside `container` whose
 * bounding box is not entirely within the container's content box (its
 * bounding box minus border and padding). Must stay self-contained — it is
 * serialized into the page.
 */
function findButtonsOutsideContentBox(container: Element): string[] {
  const rect = container.getBoundingClientRect();
  const style = getComputedStyle(container);
  const content = {
    left: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
    right: rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
    top: rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
    bottom: rect.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
  };
  const format = (box: { left: number; right: number; top: number; bottom: number }) =>
    `x ${box.left.toFixed(1)}~${box.right.toFixed(1)}, y ${box.top.toFixed(1)}~${box.bottom.toFixed(1)}`;

  return Array.from(container.querySelectorAll("button")).flatMap((button) => {
    const box = button.getBoundingClientRect();
    const inside =
      box.left >= content.left &&
      box.right <= content.right &&
      box.top >= content.top &&
      box.bottom <= content.bottom;
    if (inside) {
      return [];
    }
    const name = button.textContent?.trim() || button.getAttribute("title") || "";
    return [`"${name}" 버튼 ${format(box)} ⊄ 영역 ${format(content)}`];
  });
}

test.describe("테이블 QR 좁은 화면 레이아웃", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}x${viewport.height}: 버튼이 QR 카드 패딩 안과 본문 영역 안에 머문다`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const tables = buildTables();
      await mockDashboardData(page);
      await loginAsAdmin(page);
      await mockAdminTables(page, tables);
      await page.goto("/tables");

      // Measure the final layout only: every preview placeholder has become
      // its copy-link <button><img> and the web font has replaced the
      // fallback font the button labels were first laid out with.
      await expect(page.getByAltText(/^[BT]-\d{2} 테이블$/)).toHaveCount(tables.length);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const cardOverflows: string[] = [];
      for (const table of tables) {
        const label = `${table.id} 테이블`;
        // The label is the card's first child — the same lookup
        // `TableQrPage.test.tsx` uses (`getByText(label).closest("div")`).
        const card = page.getByText(label, { exact: true }).locator("xpath=..");
        // Copy-link (the QR image), PNG, SVG.
        await expect(card.getByRole("button")).toHaveCount(3);
        const overflows = await card.evaluate(findButtonsOutsideContentBox);
        cardOverflows.push(...overflows.map((overflow) => `${label}: ${overflow}`));
      }
      expect.soft(cardOverflows, "QR 카드 패딩 밖으로 나간 버튼").toEqual([]);

      // Covers the page-level ZIP/print buttons next to the title.
      const mainOverflows = await page.locator("#main-content").evaluate(findButtonsOutsideContentBox);
      expect.soft(mainOverflows, "본문 영역 밖으로 나간 버튼").toEqual([]);

      const widths = await page.evaluate(() => ({
        pageScroll: document.documentElement.scrollWidth,
        pageClient: document.documentElement.clientWidth,
      }));
      expect.soft(widths.pageScroll, "페이지 가로 스크롤 폭").toBeLessThanOrEqual(widths.pageClient);
    });
  }
});
