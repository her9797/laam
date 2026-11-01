import { expect, test } from "@playwright/test";

import type { AppData } from "@/features/bootstrap/model";

import { buildAppData, loginAsAdmin, mockDashboardData } from "./fixtures";

test.describe("메뉴 라벨과 손님 화면 설명", () => {
  test("라벨을 만들고 메뉴 상세에서 붙여 저장하면 성공 메시지가 보인다", async ({ page }) => {
    // Mutable server state: every mocked mutation answers with the full,
    // refreshed AppData and the bootstrap mock serves the latest copy.
    const base = buildAppData();
    let appData: AppData = {
      ...base,
      menuLabels: [],
      items: base.items.map((item) => ({
        ...item,
        posDescription: item.description,
        descriptionOverride: "",
        labelIds: [],
      })),
    };
    let contentBody: unknown = null;

    await mockDashboardData(page);
    await page.route("**/api/bootstrap", async (route) => {
      await route.fulfill({ json: appData });
    });
    await page.route("**/api/admin/menu-labels", async (route) => {
      const { text, color } = route.request().postDataJSON() as { text: string; color: string };
      appData = { ...appData, menuLabels: [{ id: "label-1", text, color, sortOrder: 0 }] };
      await route.fulfill({ status: 201, json: appData });
    });
    await page.route("**/api/admin/menu-items/menu-1/content", async (route) => {
      contentBody = route.request().postDataJSON();
      const { descriptionOverride, labelIds } = contentBody as { descriptionOverride: string; labelIds: string[] };
      appData = {
        ...appData,
        items: appData.items.map((item) =>
          item.id === "menu-1"
            ? { ...item, descriptionOverride, labelIds, description: descriptionOverride || item.description }
            : item,
        ),
      };
      await route.fulfill({ json: appData });
    });
    await page.route("**/api/admin/menu-items/menu-1/recipe", async (route) => {
      await route.fulfill({ json: { menuItemId: "menu-1", ingredients: "", instructions: "" } });
    });

    await loginAsAdmin(page);
    await page.locator('[data-slot="sidebar"]').getByRole("button", { name: "상품 관리" }).click();
    await page.getByRole("link", { name: "라벨 관리" }).click();
    await expect(page).toHaveURL(/\/menu\/labels$/);
    await expect(page.getByText("등록된 라벨이 없어요.")).toBeVisible();

    const addForm = page.getByRole("form", { name: "라벨 추가" });
    await addForm.getByLabel("라벨 이름").fill("신메뉴");
    await addForm.getByLabel("라벨 색상").selectOption("pink");
    await addForm.getByRole("button", { name: "라벨 추가" }).click();
    await expect(page.getByLabel("'신메뉴' 라벨 이름")).toHaveValue("신메뉴");

    await page.goto("/menu/menu-1");
    const contentForm = page.getByRole("form", { name: "손님 화면 설명" });
    await expect(contentForm.getByText("비우면 포스 설명을 보여줘요: 시원한 아메리카노")).toBeVisible();
    const save = contentForm.getByRole("button", { name: "저장" });
    await expect(save).toBeDisabled();

    await contentForm.getByLabel("설명").fill("산미 있는 원두");
    await contentForm.getByRole("button", { name: "신메뉴" }).click();
    await save.click();

    await expect(page.getByRole("status")).toHaveText("손님 화면 설명을 저장했어요.");
    expect(contentBody).toEqual({ descriptionOverride: "산미 있는 원두", labelIds: ["label-1"] });
    await expect(save).toBeDisabled();
  });
});
