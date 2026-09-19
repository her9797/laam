import { expect, test, type Page } from "@playwright/test";

import type { AdminTable, AdminTablesData, PosTable, PosTableSync } from "@/features/tables/model";

import { loginAsAdmin, mockDashboardData } from "./fixtures";

// The POS panel on `/tables` drives three admin endpoints that only exist
// upstream (`POST /admin/tables/pos-sync`, `GET .../pos-sync/{id}`,
// `PATCH /admin/tables/{id}/pos-link`). Here they are mocked at the BFF
// boundary, so what these tests actually prove is the browser-side flow:
// the sync button really polls until the sync settles, and the row controls
// really send what the API contract expects.

function buildTable(
  overrides: Partial<AdminTable> & Pick<AdminTable, "id" | "area" | "number">,
): AdminTable {
  return {
    qrUrl: `https://example.com/qr/enter?table=${overrides.id}&sig=e2e`,
    posTableId: null,
    posTableTitle: null,
    hallName: null,
    linkedAt: null,
    ...overrides,
  };
}

function buildPosTable(overrides: Partial<PosTable> & Pick<PosTable, "posTableId">): PosTable {
  return {
    title: `POS ${overrides.posTableId}`,
    hallId: 1,
    hallName: "1층 홀",
    capacity: 4,
    syncedAt: "2026-09-19T00:00:00Z",
    qrTableId: null,
    ...overrides,
  };
}

function buildData(overrides: Partial<AdminTablesData> = {}): AdminTablesData {
  return {
    tables: [
      buildTable({
        id: "B-01",
        area: "B",
        number: 1,
        posTableId: 11,
        posTableTitle: "바1",
        hallName: "1층 홀",
        linkedAt: "2026-09-19T00:00:00Z",
      }),
      buildTable({ id: "T-01", area: "T", number: 1 }),
    ],
    posOnlyTables: [buildPosTable({ posTableId: 900, title: "룸1", hallName: "2층 홀" })],
    lastSyncedAt: "2026-09-19T00:00:00Z",
    pendingSync: null,
    ...overrides,
  };
}

async function mockAdminTables(page: Page, data: AdminTablesData): Promise<void> {
  await page.route("**/api/admin/tables", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: data });
  });
}

function buildSync(overrides: Partial<PosTableSync> = {}): PosTableSync {
  return {
    id: "sync-1",
    status: "PENDING",
    requestedAt: "2026-09-19T00:00:00Z",
    completedAt: null,
    linkedCount: 0,
    unlinkedCount: 0,
    posOnlyCount: 0,
    error: null,
    ...overrides,
  };
}

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function openTablesPage(page: Page, data: AdminTablesData): Promise<void> {
  await mockDashboardData(page);
  await loginAsAdmin(page);
  await mockAdminTables(page, data);
  await page.goto("/tables");
  await expect(page.getByText("POS 연결", { exact: true })).toBeVisible();
}

test.describe("POS 테이블 연결", () => {
  test("동기화 버튼은 완료될 때까지 폴링하고 결과를 알린다", async ({ page }) => {
    const pollStatuses: PosTableSync["status"][] = ["RUNNING", "DONE"];
    let pollIndex = 0;

    await page.route("**/api/admin/tables/pos-sync", async (route) => {
      await route.fulfill({ status: 201, json: buildSync({ status: "PENDING" }) });
    });
    await page.route("**/api/admin/tables/pos-sync/*", async (route) => {
      const status = pollStatuses[Math.min(pollIndex, pollStatuses.length - 1)];
      pollIndex += 1;
      await route.fulfill({
        json: buildSync({ status, linkedCount: 3, unlinkedCount: 1, posOnlyCount: 2 }),
      });
    });

    await openTablesPage(page, buildData());

    const syncButton = page.getByRole("button", { name: "POS 테이블 가져오기" });
    await syncButton.click();
    await expect(page.getByRole("button", { name: "POS 테이블을 가져오는 중이에요…" })).toBeDisabled();

    await expect(page.getByText("POS 테이블을 가져왔어요.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("연결됨 3 · 연결 필요 1 · POS에만 있음 2")).toBeVisible();
    expect(pollIndex).toBeGreaterThanOrEqual(2);
  });

  test("플러그인이 응답하지 않으면 POS 확인을 안내한다", async ({ page }) => {
    await page.route("**/api/admin/tables/pos-sync", async (route) => {
      await route.fulfill({ status: 201, json: buildSync({ status: "PENDING" }) });
    });
    await page.route("**/api/admin/tables/pos-sync/*", async (route) => {
      await route.fulfill({ json: buildSync({ status: "TIMED_OUT" }) });
    });

    await openTablesPage(page, buildData());
    await page.getByRole("button", { name: "POS 테이블 가져오기" }).click();

    await expect(
      page.getByText(
        "POS 플러그인이 응답하지 않아요. POS가 켜져 있고 플러그인이 설치됐는지 확인해 주세요.",
      ),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("연결되지 않은 테이블이 있으면 주문할 수 없다고 경고한다", async ({ page }) => {
    await openTablesPage(page, buildData());

    // Next's route announcer is a second `role="alert"` on every page, so
    // the banner is picked out by its own copy.
    await expect(
      page.getByRole("alert").filter({ hasText: "이 테이블은 손님이 주문할 수 없어요" }),
    ).toBeVisible();
    await expect(page.getByText("연결 필요 1 · POS에만 있음 1")).toBeVisible();
  });

  test("이미 연결된 POS 테이블을 고르면 409 안내를 보여 준다", async ({ page }) => {
    let patchBody: unknown;
    await page.route("**/api/admin/tables/T-01/pos-link", async (route) => {
      patchBody = route.request().postDataJSON();
      await route.fulfill({ status: 409, json: { error: "already linked" } });
    });

    await openTablesPage(page, buildData());

    const row = page.getByRole("listitem", { name: "T-01 테이블" });
    await expect(row).toContainText("연결 필요");
    await row.getByRole("combobox").selectOption("900");
    await row.getByRole("button", { name: "저장" }).click();

    await expect(page.getByText("그 POS 테이블은 이미 다른 테이블에 연결돼 있어요")).toBeVisible();
    expect(patchBody).toEqual({ posTableId: 900 });
  });

  test("POS에만 있는 테이블은 자동 이름 실패 시 이름을 받아 다시 보낸다", async ({ page }) => {
    const bodies: unknown[] = [];
    await page.route("**/api/admin/tables", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) {
        await route.fulfill({ status: 400, json: { error: "cannot derive id" } });
        return;
      }
      await route.fulfill({
        status: 201,
        json: buildTable({ id: "T-11", area: "T", number: 11, posTableId: 900 }),
      });
    });

    await openTablesPage(page, buildData());

    // By accessible name, not text: "룸1" also appears in every unlinked
    // row's POS table <select>, and those rows are list items too.
    const row = page.getByRole("listitem", { name: "룸1" });
    await row.getByRole("button", { name: "QR 테이블로 추가" }).click();

    const nameInput = row.getByLabel("QR 테이블 이름");
    await expect(nameInput).toBeVisible();
    await expect(row.getByText("T-11처럼 구역 문자와 두 자리 번호")).toBeVisible();

    await nameInput.fill("T-11");
    await row.getByRole("button", { name: "추가" }).click();

    await expect(page.getByText("QR 테이블을 추가했어요.")).toBeVisible();
    expect(bodies).toEqual([{ posTableId: 900 }, { posTableId: 900, id: "T-11" }]);
  });

});

test.describe("POS 연결 레이아웃 스크린샷", () => {
  for (const [label, viewport] of [
    ["phone-390", PHONE],
    ["desktop-1280", DESKTOP],
  ] as const) {
    test(`${label}: POS 연결 영역과 테이블 목록`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await openTablesPage(page, buildData());
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect.soft(widths.scroll, "페이지 가로 스크롤 폭").toBeLessThanOrEqual(widths.client);

      // Every POS control must sit inside the viewport, not just inside a
      // scrollable page — a row that overflows is unusable on a phone.
      for (const name of ["POS 테이블 가져오기", "저장", "QR 테이블로 추가"]) {
        const box = await page.getByRole("button", { name }).first().boundingBox();
        expect(box, `${name} 버튼 위치`).not.toBeNull();
        expect.soft(box!.x, `${name} 버튼 좌측`).toBeGreaterThanOrEqual(0);
        expect
          .soft(box!.x + box!.width, `${name} 버튼 우측`)
          .toBeLessThanOrEqual(viewport.width);
      }

      await page.screenshot({ path: testInfo.outputPath(`tables-${label}.png`), fullPage: true });
    });
  }
});
