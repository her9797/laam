import { expect, test } from "@playwright/test";

import type { AppData } from "@/features/bootstrap/model";

import { buildAppData, loginAsAdmin, mockDashboardData } from "./fixtures";

test.describe("메뉴 라벨과 손님 화면 설명", () => {
  test("메뉴 상세에서 라벨을 직접 입력하고 설명과 함께 저장하면 성공 메시지가 보인다", async ({ page }) => {
    // Mutable server state: the content mock answers with the full,
    // refreshed AppData and the bootstrap mock serves the latest copy.
    const base = buildAppData();
    let appData: AppData = {
      ...base,
      items: base.items.map((item) => ({
        ...item,
        posDescription: item.description,
        descriptionOverride: "",
        customLabels: [],
      })),
    };
    let contentBody: unknown = null;

    await mockDashboardData(page);
    await page.route("**/api/bootstrap", async (route) => {
      await route.fulfill({ json: appData });
    });
    await page.route("**/api/admin/menu-items/menu-1/content", async (route) => {
      contentBody = route.request().postDataJSON();
      const { descriptionOverride, labels } = contentBody as {
        descriptionOverride: string;
        labels: { text: string; color: string }[];
      };
      appData = {
        ...appData,
        items: appData.items.map((item) =>
          item.id === "menu-1"
            ? {
                ...item,
                descriptionOverride,
                customLabels: labels,
                labels: labels.length ? labels : item.labels,
                description: descriptionOverride || item.description,
              }
            : item,
        ),
      };
      await route.fulfill({ json: appData });
    });
    await page.route("**/api/admin/menu-items/menu-1/recipe", async (route) => {
      await route.fulfill({ json: { menuItemId: "menu-1", ingredients: "", instructions: "" } });
    });

    await loginAsAdmin(page);
    // 별도 라벨 관리 메뉴는 없다.
    const sidebar = page.locator('[data-slot="sidebar"]');
    await sidebar.getByRole("button", { name: "상품 관리" }).click();
    await expect(sidebar.getByRole("link", { name: "카테고리 관리" })).toBeVisible();
    await expect(page.getByRole("link", { name: "라벨 관리" })).toHaveCount(0);

    await page.goto("/menu/menu-1");
    const contentForm = page.getByRole("form", { name: "손님 화면 설명" });
    await expect(contentForm.getByText("비우면 포스 설명을 보여줘요: 시원한 아메리카노")).toBeVisible();
    await expect(contentForm.getByText("라벨을 입력하지 않으면 포스 설명에 적은 도수(ABV)를 라벨로 보여줘요.")).toBeVisible();
    const save = contentForm.getByRole("button", { name: "저장" });
    await expect(save).toBeDisabled();

    await contentForm.getByLabel("설명").fill("산미 있는 원두");
    await contentForm.getByRole("button", { name: "라벨 추가" }).click();
    await contentForm.getByRole("textbox", { name: "라벨 1 글자" }).fill("신메뉴");
    await contentForm.getByRole("button", { name: "라벨 추가" }).click();
    await contentForm.getByRole("textbox", { name: "라벨 2 글자" }).fill("인기");
    await contentForm.getByRole("combobox", { name: "라벨 2 색상" }).selectOption("pink");
    await save.click();

    await expect(page.getByRole("status")).toHaveText("손님 화면 설명을 저장했어요.");
    expect(contentBody).toEqual({
      descriptionOverride: "산미 있는 원두",
      labels: [
        { text: "신메뉴", color: "green" },
        { text: "인기", color: "pink" },
      ],
    });
    await expect(save).toBeDisabled();
    await expect(contentForm.getByRole("textbox", { name: "라벨 2 글자" })).toHaveValue("인기");
  });

  test("라벨 관리 주소는 더 이상 없어 메뉴 상세의 '찾을 수 없음'으로 떨어진다", async ({ page }) => {
    // /menu/labels 전용 라우트가 사라져 동적 라우트 /menu/[id]가 id "labels"로 받는다.
    await mockDashboardData(page);
    await page.route("**/api/bootstrap", async (route) => {
      await route.fulfill({ json: buildAppData() });
    });
    await loginAsAdmin(page);

    await page.goto("/menu/labels");
    await expect(page.getByText("메뉴를 찾을 수 없습니다.")).toBeVisible();
  });
});
