import { expect, test } from "@playwright/test";

import {
  buildAppData,
  buildCustomerRequests,
  buildSpecialRequests,
  loginAsAdmin,
  mockBootstrap,
  mockCreateMenuItem,
  mockCreateNotice,
  mockCustomerRequestStatusUpdate,
  mockCustomerRequestsPage,
  mockDashboardData,
  mockSpecialRequestDelete,
  mockSpecialRequestsPage,
} from "./fixtures";

// Every test below builds its own fixtures via `buildAppData()` /
// `buildCustomerRequests()` / `buildSpecialRequests()` and registers its own
// `page.route` mocks — Playwright already gives each test a fresh page and
// browser context, and no fixture object here is shared/mutated across
// tests, so none of these flows can leak state into another.

test.describe("관리자 MVP 핵심 흐름", () => {
  test("올바른 비밀번호로 로그인하면 대시보드로 이동하고 데이터가 표시된다", async ({ page }) => {
    await mockDashboardData(page);

    await page.goto("/login");
    await page.getByLabel("비밀번호").fill("test-admin-password");
    await page.getByRole("button", { name: "로그인" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    // The URL alone can change on a bare redirect; the dashboard only
    // renders this heading once its bootstrap/requests/special-requests
    // queries all resolve — so this additionally proves the mocked BFF
    // data actually loaded, not just that the login redirect fired.
    await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  });

  test("일반 요청의 상태를 확인 처리로 변경한다", async ({ page }) => {
    await mockDashboardData(page);
    await loginAsAdmin(page);

    // `/requests` reads the paged envelope, not the bare array the
    // notification bell reads (already mocked by `mockDashboardData`) — and
    // the PATCH below invalidates rather than seeds that query, so the list
    // refetches afterwards and the mock has to move with it.
    const listState = { requests: buildCustomerRequests() };
    await mockCustomerRequestsPage(page, listState);
    const refreshedRequests = listState.requests.map((request) =>
      request.id === "r1" ? { ...request, status: "checked" as const } : request,
    );
    await mockCustomerRequestStatusUpdate(page, refreshedRequests, listState);

    await page.goto("/requests");
    const row = page.locator("tr", { hasText: "물 좀 주세요" });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "확인" }).click();

    // r1 is now "checked", whose own next action is "처리완료" — a
    // different label than the "확인" button it started with, so this
    // proves the PATCH mock's refreshed status actually rendered.
    await expect(row.getByRole("button", { name: "처리완료" })).toBeVisible();
  });

  test("특별 요청을 확인 대화상자에서 삭제하면 목록에서 사라진다", async ({ page }) => {
    await mockDashboardData(page);
    await loginAsAdmin(page);

    // Same paged-envelope/refetch-after-mutation shape as the general
    // request test above.
    const listState = { requests: buildSpecialRequests() };
    await mockSpecialRequestsPage(page, listState);
    await mockSpecialRequestDelete(page, [], listState);

    await page.goto("/special-requests");
    await expect(page.getByText("홍길동")).toBeVisible();

    await page.getByRole("button", { name: "삭제" }).click();
    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "삭제" }).click();

    await expect(page.getByText("접수된 특별 요청이 없습니다.")).toBeVisible();
  });

  test("메뉴를 새로 등록하면 목록에 표시된다", async ({ page }) => {
    await mockDashboardData(page);
    await loginAsAdmin(page);

    const appData = buildAppData();
    await mockBootstrap(page, appData);
    const refreshedAppData = {
      ...appData,
      items: [
        ...appData.items,
        {
          id: "menu-2",
          categoryId: "drinks",
          badge: "",
          badgeColor: "",
          name: "라떼",
          description: "",
          price: "4500",
          isVisible: true,
        },
      ],
    };
    await mockCreateMenuItem(page, refreshedAppData);

    await page.goto("/menu");
    await expect(page.getByText("아메리카노")).toBeVisible();

    // The create form lives in a dialog behind this trigger now (see
    // `features/menu/MenuItemForm.tsx`); it is no longer inline on the page.
    await page.getByRole("button", { name: "메뉴 추가" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog.getByRole("heading", { name: "메뉴 등록" })).toBeVisible();

    await createDialog.getByLabel("이름", { exact: true }).fill("라떼");
    await createDialog.getByLabel("가격", { exact: true }).fill("4500");
    await createDialog.getByRole("button", { name: "저장" }).click();

    await expect(page.getByText("라떼")).toBeVisible();
  });

  test("공지를 새로 등록하면 목록에 표시된다", async ({ page }) => {
    await mockDashboardData(page);
    await loginAsAdmin(page);

    const appData = buildAppData();
    await mockBootstrap(page, appData);
    const refreshedAppData = {
      ...appData,
      notices: [...appData.notices, { id: "notice-2", text: "새 이벤트 안내", isVisible: true }],
    };
    await mockCreateNotice(page, refreshedAppData);

    await page.goto("/notices");
    await expect(page.getByText("매주 수요일 하이볼 1,000원 할인")).toBeVisible();

    // Same move as the menu screen: the create form is behind this trigger
    // in a dialog, and the page itself now only carries a search box (whose
    // "공지 문구로 검색" label a page-wide `getByLabel("공지 문구")` would
    // otherwise match, filtering the list instead of filling the form).
    await page.getByRole("button", { name: "공지 추가" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog.getByRole("heading", { name: "새 공지/이벤트 등록" })).toBeVisible();

    await createDialog.getByLabel("공지 문구", { exact: true }).fill("새 이벤트 안내");
    await createDialog.getByRole("button", { name: "등록" }).click();

    await expect(page.getByText("새 이벤트 안내")).toBeVisible();
  });
});
