import { expect, test, type Page } from "@playwright/test";

import { createExpenseServerState, mockExpenseApi, type ExpenseServerState } from "./expense-fixtures";
import { loginAsAdmin, mockDashboardData } from "./fixtures";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function openExpenses(page: Page, state: ExpenseServerState, viewport = PHONE) {
  await page.setViewportSize(viewport);
  await mockDashboardData(page);
  await loginAsAdmin(page);
  await mockExpenseApi(page, state);
  await page.goto("/expenses?month=2026-09");
  await expect(page.getByText("98,000원").first()).toBeVisible();
}

test.describe("지출 화면 (휴대폰)", () => {
  test.use({ viewport: PHONE });

  test("영수증을 품목 줄과 기타 지출 줄로 추가하고 재고 반영 토스트를 본다", async ({ page }) => {
    const state = createExpenseServerState();
    await openExpenses(page, state);

    await expect(page.getByText("지난달보다 132,000원 적어요")).toBeVisible();

    // On a phone the add button is pinned to the bottom of the screen.
    const addButton = page.getByRole("button", { name: "영수증 추가" });
    await expect(addButton).toHaveCount(1);
    const box = await addButton.boundingBox();
    expect(box && box.y + box.height).toBeGreaterThan(PHONE.height - 80);
    await addButton.click();

    const sheet = page.getByRole("dialog", { name: "영수증 추가" });
    await expect(sheet).toBeVisible();

    await sheet.getByRole("group", { name: "최근 거래처" }).getByRole("button", { name: "코스트코" }).click();
    await expect(sheet.getByRole("textbox", { name: "거래처" })).toHaveValue("코스트코");
    await sheet.getByRole("button", { name: "현금" }).click();

    const itemLine = sheet.getByRole("group", { name: "품목 줄 1" });
    await itemLine.getByRole("combobox").click();
    await page.getByRole("option", { name: "탱커레이 진" }).click();
    await expect(itemLine.getByRole("combobox")).toContainText("탱커레이 진");
    await expect(itemLine.getByText("최근 단가 31,000원")).toBeVisible();
    await itemLine.getByRole("button", { name: "수량 1 늘리기" }).click();
    await expect(itemLine.getByRole("textbox", { name: "수량" })).toHaveValue("2");
    await itemLine.getByRole("textbox", { name: "금액" }).fill("64000");
    await expect(itemLine.getByRole("textbox", { name: "금액" })).toHaveValue("64,000");
    await expect(itemLine.getByText("단가 32,000원")).toBeVisible();

    await sheet.getByRole("button", { name: "기타 지출 추가" }).click();
    const otherLine = sheet.getByRole("group", { name: "기타 지출 줄 2" });
    await expect(otherLine.getByRole("combobox", { name: "분류" })).toHaveValue("other");
    await otherLine.getByRole("textbox", { name: "내용" }).fill("얼음");
    await otherLine.getByRole("textbox", { name: "금액" }).fill("5000");

    await expect(sheet.getByText("69,000원")).toBeVisible();
    await sheet.getByRole("button", { name: "저장" }).click();

    await expect(page.getByText("영수증을 저장했어요 · 재고 1개 품목 반영")).toBeVisible();
    await expect(sheet).toBeHidden();

    expect(state.receiptBodies).toHaveLength(1);
    const body = state.receiptBodies[0];
    expect(body).toMatchObject({
      vendor: "코스트코",
      paymentMethod: "cash",
      memo: "",
      lines: [
        { itemId: "gin", quantity: 2, amount: 64000 },
        { categoryId: "other", description: "얼음", amount: 5000 },
      ],
    });
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(state.items.find((item) => item.id === "gin")?.quantity).toBe(3);
  });

  test("영수증 수량을 고쳐 저장하면 확인 창에 바뀌는 재고를 먼저 보여 준다", async ({ page }) => {
    const state = createExpenseServerState();
    await openExpenses(page, state);

    await page.getByRole("button", { name: /코스트코/ }).click();
    const sheet = page.getByRole("dialog", { name: "영수증 수정" });
    const itemLine = sheet.getByRole("group", { name: "품목 줄 1" });
    await expect(itemLine.getByRole("textbox", { name: "수량" })).toHaveValue("3");
    await itemLine.getByRole("button", { name: "수량 1 줄이기" }).click();
    await sheet.getByRole("button", { name: "저장" }).click();

    const confirm = page.getByRole("alertdialog", { name: "영수증을 수정할까요?" });
    await expect(confirm).toContainText("탱커레이 진");
    await expect(confirm).toContainText("-1병");
    expect(state.receiptBodies).toHaveLength(0);

    await confirm.getByRole("button", { name: "수정 저장" }).click();
    await expect(page.getByText("영수증을 저장했어요 · 재고 1개 품목 반영")).toBeVisible();
    expect(state.receiptBodies[0].lines[0]).toEqual({ itemId: "gin", quantity: 2, amount: 93000 });
    expect(state.items.find((item) => item.id === "gin")?.quantity).toBe(0);
  });

  test("분류 막대를 누르면 그 분류가 들어간 영수증만 보고 다시 누르면 해제한다", async ({ page }) => {
    const state = createExpenseServerState();
    await openExpenses(page, state);

    const liquor = page.getByRole("button", { name: /^술/ });
    await expect(liquor).toContainText("93,000원");
    await liquor.click();
    await expect(page).toHaveURL(/month=2026-09&categoryId=liquor/);
    await expect(liquor).toHaveAttribute("aria-pressed", "true");

    await liquor.click();
    await expect(page).toHaveURL(/\/expenses\?month=2026-09$/);
  });
});

test.describe("재고 화면 (휴대폰)", () => {
  test.use({ viewport: PHONE });

  test("−/+ 버튼으로 수량을 바꾸면 모아서 한 번에 저장한다", async ({ page }) => {
    const state = createExpenseServerState();
    await page.setViewportSize(PHONE);
    await mockDashboardData(page);
    await loginAsAdmin(page);
    await mockExpenseApi(page, state);
    await page.goto("/inventory");

    const lime = page.getByRole("listitem", { name: "라임" });
    await lime.getByRole("button", { name: "라임 1 늘리기" }).click();
    await lime.getByRole("button", { name: "라임 1 늘리기" }).click();
    await expect(lime.getByRole("button", { name: /라임 지금 남은 수량 입력/ })).toContainText("14");

    await expect.poll(() => state.adjustBodies).toEqual([{ itemId: "lime", body: { delta: 2 } }]);
    await expect(page.getByText("라임 14개로 저장했어요.")).toBeVisible();

    await lime.getByRole("button", { name: "라임 1 줄이기" }).click();
    await expect.poll(() => state.adjustBodies.at(-1)).toEqual({ itemId: "lime", body: { delta: -1 } });
    await expect(lime.getByRole("button", { name: /라임 지금 남은 수량 입력/ })).toContainText("13");
  });
});

test.describe("지출 화면 레이아웃 스크린샷", () => {
  for (const [label, viewport] of [
    ["phone-390", PHONE],
    ["desktop-1280", DESKTOP],
  ] as const) {
    test(`${label}: 요약·목록과 영수증 시트`, async ({ page }, testInfo) => {
      const state = createExpenseServerState();
      await openExpenses(page, state, viewport);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect.soft(widths.scroll, "페이지 가로 스크롤 폭").toBeLessThanOrEqual(widths.client);

      await page.screenshot({ path: testInfo.outputPath(`expenses-${label}.png`), fullPage: true });

      await page.getByRole("button", { name: "영수증 추가" }).click();
      const sheet = page.getByRole("dialog", { name: "영수증 추가" });
      await sheet.getByRole("button", { name: "기타 지출 추가" }).click();
      await expect(sheet.getByRole("group", { name: "기타 지출 줄 2" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`expenses-sheet-${label}.png`) });
    });
  }
});
