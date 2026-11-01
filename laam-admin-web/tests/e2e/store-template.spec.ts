import { expect, test, type Page } from "@playwright/test";

import { buildAppData, loginAsAdmin, mockDashboardData } from "./fixtures";

const PREVIEW_URL = "https://menu.example.test/?preview=signed-token";

async function openStoreTemplateViaNav(page: Page): Promise<void> {
  await mockDashboardData(page);
  await loginAsAdmin(page);
  // Scoped to the sidebar: the dashboard's shortcut cards may repeat nav labels.
  await page.locator('[data-slot="sidebar"]').getByRole("link", { name: "손님 화면 템플릿" }).click();
  await expect(page).toHaveURL(/\/store-template$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("손님 화면 템플릿");
}

test.describe("손님 화면 템플릿", () => {
  test("메뉴에서 이동해 공책 템플릿을 고르고 적용하면 성공 메시지가 보인다", async ({ page }) => {
    let patchBody: unknown = null;
    await page.route("**/api/admin/store-template", async (route) => {
      patchBody = route.request().postDataJSON();
      const appData = buildAppData();
      await route.fulfill({
        json: { ...appData, store: { ...appData.store, customerTemplate: "notebook" } },
      });
    });

    await openStoreTemplateViaNav(page);

    const apply = page.getByRole("button", { name: "적용" });
    await expect(page.getByRole("radio", { name: /기본\(다크\)/ })).toBeChecked();
    await expect(apply).toBeDisabled();

    await page.getByText("공책", { exact: true }).click();
    await expect(page.getByRole("radio", { name: /공책/ })).toBeChecked();
    await apply.click();

    await expect(page.getByRole("status")).toHaveText("손님 화면 템플릿을 적용했어요.");
    expect(patchBody).toEqual({ template: "notebook" });
  });

  test("미리보기를 누르면 새 탭이 받은 미리보기 주소로 열린다", async ({ page }) => {
    await page.route("**/api/admin/store-template/preview", async (route) => {
      await route.fulfill({ json: { url: PREVIEW_URL } });
    });
    // The preview tab is a separate page, so the customer-web origin is mocked
    // on the whole context (a `page.route` would not reach the popup).
    await page.context().route("https://menu.example.test/**", async (route) => {
      await route.fulfill({ contentType: "text/html", body: "<title>preview</title>" });
    });

    await openStoreTemplateViaNav(page);

    await page.getByText("칠판", { exact: true }).click();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("button", { name: "미리보기" }).click(),
    ]);

    await popup.waitForURL(PREVIEW_URL);
    expect(popup.url()).toBe(PREVIEW_URL);
  });
});
