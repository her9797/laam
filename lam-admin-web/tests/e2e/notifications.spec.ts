import { expect, test } from "@playwright/test";

import type { CustomerRequest } from "@/features/requests/model";

import {
  buildCustomerRequests,
  loginAsAdmin,
  mockCustomerRequestsBulkStatusUpdate,
  mockCustomerRequestStatusUpdate,
  mockDashboardData,
} from "./fixtures";

// Each test builds its own fixtures and registers its own `page.route`
// mocks, per this suite's existing convention (see `admin-mvp.spec.ts`).
//
// The bell is addressed by its accessible name throughout, which is
// `notifications:bellLabel` ("새 알림 {{count}}건") while anything is unread
// and `notifications:bellLabelEmpty` ("손님 요청 알림") when nothing is —
// two different strings, so the name a test uses also asserts which of the
// two states the bell is in, and with it the unread count.
//
// What this file deliberately does NOT assert: that the destination list
// screen (`/requests`, `/song-requests`) re-renders the updated row after
// the notification click's mutation invalidates and refetches
// `requestsKeys.all`. Proving that would require this file's mocks to also
// emulate `RequestListPage`'s paged-query response envelope
// (`{ items, page, pageSize, total }`, see `features/requests/api.ts`'s
// `fetchCustomerRequestsPage`), which is that screen's own concern and
// already covered by `RequestListPage.test.tsx`. This file's job is the
// bell/panel itself: it asserts the mutation actually fires (by inspecting
// the intercepted request) and that navigation happens, not what the
// destination screen does with the refreshed data.

test.describe("관리자 알림", () => {
  test("헤더 알림 종에 미처리 요청이 표시되고, 항목을 클릭하면 확인 처리 후 해당 목록으로 이동한다", async ({
    page,
  }) => {
    const requests = buildCustomerRequests(); // r1: general/pending, r2: song/pending
    await mockDashboardData(page, { requests });
    await loginAsAdmin(page);

    const bell = page.getByRole("button", { name: "새 알림 2건" });
    await expect(bell).toBeVisible();
    await expect(bell.getByText("2", { exact: true })).toBeVisible();

    await bell.click();
    const panel = page.getByText("손님 요청 알림", { exact: true }).locator("..").locator("..");
    await expect(panel.getByText("물 좀 주세요")).toBeVisible();
    await expect(panel.getByText("Dynamite - BTS")).toBeVisible();
    await expect(panel.getByText("바로 전달하기")).toBeVisible();
    await expect(panel.getByText("노래 신청")).toBeVisible();

    const refreshedRequests = requests.map((request) =>
      request.id === "r1" ? { ...request, status: "checked" as const } : request,
    );
    await mockCustomerRequestStatusUpdate(page, refreshedRequests);

    const [patchRequest] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes("/api/admin/customer-requests/r1/status") &&
          req.method() === "PATCH",
      ),
      panel.getByText("물 좀 주세요").click(),
    ]);

    expect(patchRequest.postDataJSON()).toEqual({ status: "checked" });
    // Pathname only: `RequestListPage`'s mount effect immediately replaces
    // the URL with its default date window (`?dateFrom=…&dateTo=…`), so
    // matching the whole URL would be a race against that replace rather
    // than a check that the click landed on this screen.
    await expect(page).toHaveURL((url) => url.pathname === "/requests");
  });

  test("노래 신청 알림을 클릭하면 노래 신청 목록으로 이동한다", async ({ page }) => {
    const requests = buildCustomerRequests();
    await mockDashboardData(page, { requests });
    await loginAsAdmin(page);

    await mockCustomerRequestStatusUpdate(
      page,
      requests.map((request) => (request.id === "r2" ? { ...request, status: "checked" as const } : request)),
    );

    await page.getByRole("button", { name: "새 알림 2건" }).click();
    const panel = page.getByText("손님 요청 알림", { exact: true }).locator("..").locator("..");
    await panel.getByText("Dynamite - BTS").click();

    // Pathname only — see the first test for why.
    await expect(page).toHaveURL((url) => url.pathname === "/song-requests");
  });

  test("미처리 요청이 없으면 배지가 없고 패널에 빈 상태가 보인다", async ({ page }) => {
    const requests: CustomerRequest[] = buildCustomerRequests().map((request) => ({
      ...request,
      status: "checked",
    }));
    await mockDashboardData(page, { requests });
    await loginAsAdmin(page);

    const bell = page.getByRole("button", { name: "손님 요청 알림" });
    await expect(bell).toBeVisible();
    await expect(bell.getByText(/^\d+$/)).toHaveCount(0);

    await bell.click();
    await expect(page.getByText("확인하지 않은 요청이 없습니다.")).toBeVisible();
  });

  test("'모두 확인'은 확인 대화상자를 거쳐 표시된 모든 미처리 요청을 한 번에 확인 처리한다", async ({
    page,
  }) => {
    const requests = buildCustomerRequests();
    await mockDashboardData(page, { requests });
    await loginAsAdmin(page);

    const refreshedRequests = requests.map((request) => ({ ...request, status: "checked" as const }));
    await mockCustomerRequestsBulkStatusUpdate(page, refreshedRequests);

    await page.getByRole("button", { name: "새 알림 2건" }).click();
    await page.getByRole("button", { name: "모두 확인" }).click();

    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toBeVisible();
    // "모두 확인" covers only the general requests on show — a song request
    // stays pending until it is approved — so the count here is 1 (r1), not
    // the 2 the badge shows.
    await expect(
      confirmDialog.getByText(
        "표시된 일반 요청 1건을 모두 확인 처리합니다. 노래 신청은 승인 전까지 유지됩니다.",
      ),
    ).toBeVisible();

    const [bulkRequest] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().endsWith("/api/admin/customer-requests") && req.method() === "PATCH",
      ),
      confirmDialog.getByRole("button", { name: "확인" }).click(),
    ]);

    // Only the general requests are sent: r2 is a song request, which
    // `handleConfirmMarkAll` filters out (see `NotificationBell`), leaving
    // r1 alone — the same split the dialog copy asserted above.
    expect(bulkRequest.postDataJSON()).toEqual({ ids: ["r1"], status: "checked" });
  });

  test("'모두 확인' 대화상자를 취소하면 아무 것도 처리되지 않는다", async ({ page }) => {
    const requests = buildCustomerRequests();
    await mockDashboardData(page, { requests });
    await loginAsAdmin(page);

    let bulkPatchCalled = false;
    await page.route("**/api/admin/customer-requests", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.fallback();
        return;
      }
      bulkPatchCalled = true;
      await route.fulfill({ json: requests });
    });

    await page.getByRole("button", { name: "새 알림 2건" }).click();
    await page.getByRole("button", { name: "모두 확인" }).click();

    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "취소" }).click();

    await expect(confirmDialog).not.toBeVisible();
    expect(bulkPatchCalled).toBe(false);
  });

  test("알림음 토글이 켜짐/꺼짐 상태를 오간다", async ({ page }) => {
    await mockDashboardData(page);
    await loginAsAdmin(page);

    // Whether a fresh `AudioContext` starts `suspended` (blocked, needing a
    // user gesture before `useNotificationSound.playChime()` can produce
    // sound — see plan section 4.4) or already `running` depends on the
    // browser's autoplay policy, which behaves differently under
    // Playwright's automated Chromium than a real interactive session (in
    // practice it starts unblocked here). So this covers whichever start
    // state actually occurs, then exercises the mute/unmute toggle itself.
    const blockedButton = page.getByRole("button", { name: "알림음이 꺼져 있습니다. 눌러서 켜기" });
    const muteButton = page.getByRole("button", { name: "알림음 끄기" });
    const unmuteButton = page.getByRole("button", { name: "알림음 켜기" });

    if (await blockedButton.isVisible()) {
      await blockedButton.click();
    }
    await expect(muteButton).toBeVisible();

    await muteButton.click();
    await expect(unmuteButton).toBeVisible();

    await unmuteButton.click();
    await expect(muteButton).toBeVisible();
  });
});
