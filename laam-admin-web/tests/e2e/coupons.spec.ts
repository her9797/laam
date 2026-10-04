import { expect, test, type Page } from "@playwright/test";

import type { SecretCoupon } from "@/features/coupons/model";

import { loginAsAdmin, mockDashboardData } from "./fixtures";

function buildCoupons(): SecretCoupon[] {
  return [
    {
      id: "c1",
      rewardLabel: "하이볼 1잔",
      hidingNote: "손님 홈 화면의 LP판을 누르면 발견",
      sortOrder: 1,
      claimedAt: null,
      tableNumber: "",
      redeemedAt: null,
    },
    {
      id: "c2",
      rewardLabel: "시그니처 안주 1개 (아주 긴 보상 문구가 줄바꿈되는지 확인합니다)",
      hidingNote:
        "메뉴판 맨 뒷장 구석에 아주 작게 적힌 문구를 찾아 읽으면 발견할 수 있다는 긴 설명입니다. 줄바꿈이 잘 되는지 확인합니다.",
      sortOrder: 2,
      claimedAt: "2026-10-03T10:00:00Z",
      tableNumber: "T-03",
      redeemedAt: null,
    },
    {
      id: "c3",
      rewardLabel: "맥주 1병",
      hidingNote: "",
      sortOrder: 3,
      claimedAt: "2026-10-03T11:00:00Z",
      tableNumber: "B-01",
      redeemedAt: "2026-10-03T12:00:00Z",
    },
    {
      id: "c4",
      rewardLabel: "과일 안주",
      hidingNote: "계산대 옆 화분",
      sortOrder: 4,
      claimedAt: null,
      tableNumber: "",
      redeemedAt: null,
    },
    {
      id: "c5",
      rewardLabel: "소주 1병",
      hidingNote: "화장실 거울 뒤",
      sortOrder: 5,
      claimedAt: null,
      tableNumber: "",
      redeemedAt: null,
    },
  ];
}

/** Mocks `GET /api/admin/secret-coupons` (the BFF proxy to `laam-api`). */
async function mockSecretCoupons(page: Page, coupons: SecretCoupon[]): Promise<void> {
  await page.route("**/api/admin/secret-coupons", async (route) => {
    await route.fulfill({ json: coupons });
  });
}

test.describe("coupon management", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders the coupon cards at 390px without horizontal scrolling", async ({ page }) => {
    await mockDashboardData(page);
    await mockSecretCoupons(page, buildCoupons());
    await loginAsAdmin(page);

    await page.goto("/coupons");

    await expect(page.getByRole("heading", { name: "쿠폰 관리" })).toBeVisible();
    await expect(page.getByText("발견 2/5 · 교환 1")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "하이볼 1잔" })).toBeVisible();
    await expect(page.getByText("손님 홈 화면의 LP판을 누르면 발견")).toBeVisible();
    await expect(page.getByText("줄바꿈이 잘 되는지 확인합니다.")).toBeVisible();
    await expect(page.getByText("숨긴 위치 메모가 없어요")).toBeVisible();
    await expect(page.getByRole("button", { name: "교환 처리" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "초기화" })).toHaveCount(2);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Touch targets stay at least 44px tall.
    const heights = await page
      .getByRole("listitem")
      .getByRole("button")
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
  });
});
