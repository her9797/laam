import type { Page, Route } from "@playwright/test";

import type {
  ExpenseReceipt,
  ExpenseReceiptInput,
  ExpenseSummary,
} from "@/features/expenses/model";
import type { ExpenseCategory, InventoryItem } from "@/features/inventory/model";

/**
 * In-memory stand-in for the expense/inventory part of `laam-api`, so the
 * receipt and stock screens can save and re-fetch in a real browser. It
 * applies the documented contract effects that the screens show back:
 * a receipt's item lines add to stock, `adjust` changes one item.
 */
export type ExpenseServerState = {
  categories: ExpenseCategory[];
  items: InventoryItem[];
  receipts: ExpenseReceipt[];
  /** Every receipt POST/PATCH body, in order. */
  receiptBodies: ExpenseReceiptInput[];
  /** Every adjust body, in order. */
  adjustBodies: Array<{ itemId: string; body: { delta?: number; set?: number } }>;
};

export function buildExpenseCategories(): ExpenseCategory[] {
  return [
    { id: "liquor", name: "술", sortOrder: 1, isDefault: true },
    { id: "glass", name: "잔", sortOrder: 2, isDefault: true },
    { id: "garnish", name: "가니시", sortOrder: 3, isDefault: true },
    { id: "beverage", name: "음료", sortOrder: 4, isDefault: true },
    { id: "supplies", name: "가게 자재", sortOrder: 5, isDefault: true },
    { id: "other", name: "기타", sortOrder: 6, isDefault: true },
  ];
}

function inventoryItem(overrides: Partial<InventoryItem> & Pick<InventoryItem, "id" | "name">): InventoryItem {
  return {
    categoryId: "liquor",
    unit: "병",
    quantity: 0,
    minQuantity: 0,
    isArchived: false,
    needsReorder: false,
    needsCheck: false,
    lastUnitPrice: null,
    lastPurchasedAt: null,
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

export function buildInventoryItems(): InventoryItem[] {
  return [
    inventoryItem({
      id: "gin",
      name: "탱커레이 진",
      quantity: 1,
      minQuantity: 3,
      needsReorder: true,
      lastUnitPrice: 31000,
      lastPurchasedAt: "2026-09-10T03:00:00Z",
    }),
    inventoryItem({ id: "lime", name: "라임", categoryId: "garnish", unit: "개", quantity: 12, minQuantity: 5 }),
  ];
}

export function buildExpenseReceipts(): ExpenseReceipt[] {
  return [
    {
      id: "receipt-1",
      date: "2026-09-12",
      vendor: "코스트코",
      paymentMethod: "card",
      memo: "",
      total: 98000,
      hasImage: false,
      lines: [
        {
          id: "line-1",
          itemId: "gin",
          itemName: "탱커레이 진",
          categoryId: "liquor",
          description: "",
          quantity: 3,
          amount: 93000,
        },
        {
          id: "line-2",
          itemId: null,
          itemName: "얼음",
          categoryId: "other",
          description: "얼음",
          quantity: null,
          amount: 5000,
        },
      ],
      createdAt: "2026-09-12T05:00:00Z",
      updatedAt: "2026-09-12T05:00:00Z",
    },
  ];
}

export function createExpenseServerState(): ExpenseServerState {
  return {
    categories: buildExpenseCategories(),
    items: buildInventoryItems(),
    receipts: buildExpenseReceipts(),
    receiptBodies: [],
    adjustBodies: [],
  };
}

function withQuantity(item: InventoryItem, quantity: number): InventoryItem {
  return {
    ...item,
    quantity,
    needsReorder: !item.isArchived && quantity < item.minQuantity,
    needsCheck: quantity < 0,
  };
}

function summarize(state: ExpenseServerState, month: string): ExpenseSummary {
  const inMonth = state.receipts.filter((receipt) => receipt.date.startsWith(month));
  const byCategory = new Map<string, number>();
  for (const line of inMonth.flatMap((receipt) => receipt.lines)) {
    byCategory.set(line.categoryId, (byCategory.get(line.categoryId) ?? 0) + line.amount);
  }
  return {
    month,
    total: inMonth.reduce((sum, receipt) => sum + receipt.total, 0),
    previousMonthTotal: 230000,
    receiptCount: inMonth.length,
    byCategory: [...byCategory]
      .map(([categoryId, amount]) => ({
        categoryId,
        name: state.categories.find((category) => category.id === categoryId)?.name ?? categoryId,
        amount,
      }))
      .filter((entry) => entry.amount > 0)
      .sort((a, b) => b.amount - a.amount),
  };
}

function createReceipt(state: ExpenseServerState, input: ExpenseReceiptInput): ExpenseReceipt {
  const id = `receipt-${state.receipts.length + 1}`;
  const now = new Date().toISOString();
  const lines = input.lines.map((line, index) => {
    if ("itemId" in line) {
      const item = state.items.find((candidate) => candidate.id === line.itemId);
      state.items = state.items.map((candidate) =>
        candidate.id === line.itemId ? withQuantity(candidate, candidate.quantity + line.quantity) : candidate,
      );
      return {
        id: `${id}-line-${index}`,
        itemId: line.itemId,
        itemName: item?.name ?? "",
        categoryId: item?.categoryId ?? "other",
        description: "",
        quantity: line.quantity,
        amount: line.amount,
      };
    }
    return {
      id: `${id}-line-${index}`,
      itemId: null,
      itemName: line.description,
      categoryId: line.categoryId,
      description: line.description,
      quantity: null,
      amount: line.amount,
    };
  });
  return {
    id,
    date: input.date,
    vendor: input.vendor,
    paymentMethod: input.paymentMethod,
    memo: input.memo,
    total: lines.reduce((sum, line) => sum + line.amount, 0),
    hasImage: false,
    lines,
    createdAt: now,
    updatedAt: now,
  };
}

/** Registers every expense/inventory BFF route the screens call. */
export async function mockExpenseApi(page: Page, state: ExpenseServerState): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/admin/expense-categories",
    (route) => route.fulfill({ json: state.categories }),
  );

  await page.route(
    (url) => url.pathname === "/api/admin/inventory-items",
    (route) => route.fulfill({ json: state.items.filter((item) => !item.isArchived) }),
  );

  await page.route(
    (url) => /^\/api\/admin\/inventory-items\/[^/]+\/adjustments$/.test(url.pathname),
    (route) => route.fulfill({ json: [] }),
  );

  await page.route(
    (url) => /^\/api\/admin\/inventory-items\/[^/]+\/adjust$/.test(url.pathname),
    async (route: Route) => {
      const itemId = new URL(route.request().url()).pathname.split("/")[4];
      const body = route.request().postDataJSON() as { delta?: number; set?: number };
      state.adjustBodies.push({ itemId, body });
      const item = state.items.find((candidate) => candidate.id === itemId);
      if (!item) {
        await route.fulfill({ status: 404, json: { error: "not found" } });
        return;
      }
      const updated = withQuantity(item, body.set ?? item.quantity + (body.delta ?? 0));
      state.items = state.items.map((candidate) => (candidate.id === itemId ? updated : candidate));
      await route.fulfill({ json: updated });
    },
  );

  await page.route(
    (url) => url.pathname === "/api/admin/expenses/summary",
    (route) => {
      const month = new URL(route.request().url()).searchParams.get("month") ?? "";
      return route.fulfill({ json: summarize(state, month) });
    },
  );

  await page.route(
    (url) => url.pathname === "/api/admin/inventory/summary",
    (route) =>
      route.fulfill({
        json: {
          reorderCount: state.items.filter((item) => item.needsReorder).length,
          needsCheckCount: state.items.filter((item) => item.needsCheck).length,
        },
      }),
  );

  await page.route(
    (url) => /^\/api\/admin\/expense-receipts\/[^/]+$/.test(url.pathname),
    async (route) => {
      const request = route.request();
      const id = new URL(request.url()).pathname.split("/")[4];
      const existing = state.receipts.find((receipt) => receipt.id === id);
      if (!existing) {
        await route.fulfill({ status: 404, json: { error: "not found" } });
        return;
      }
      if (request.method() !== "PATCH") {
        await route.fulfill({ status: 405, json: { error: "unsupported in this mock" } });
        return;
      }
      const input = request.postDataJSON() as ExpenseReceiptInput;
      state.receiptBodies.push(input);
      // Take the old lines back out of stock, then apply the new ones.
      for (const line of existing.lines) {
        if (line.itemId !== null && line.quantity !== null) {
          state.items = state.items.map((item) =>
            item.id === line.itemId ? withQuantity(item, item.quantity - (line.quantity ?? 0)) : item,
          );
        }
      }
      const updated = { ...createReceipt(state, input), id, createdAt: existing.createdAt };
      state.receipts = state.receipts.map((receipt) => (receipt.id === id ? updated : receipt));
      await route.fulfill({ json: updated });
    },
  );

  await page.route(
    (url) => url.pathname === "/api/admin/expense-receipts",
    async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        const input = request.postDataJSON() as ExpenseReceiptInput;
        state.receiptBodies.push(input);
        const receipt = createReceipt(state, input);
        state.receipts = [receipt, ...state.receipts].sort((a, b) =>
          a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1,
        );
        await route.fulfill({ status: 201, json: receipt });
        return;
      }
      const params = new URL(request.url()).searchParams;
      const month = params.get("month") ?? "";
      const categoryId = params.get("categoryId");
      await route.fulfill({
        json: state.receipts.filter(
          (receipt) =>
            receipt.date.startsWith(month) &&
            (!categoryId || receipt.lines.some((line) => line.categoryId === categoryId)),
        ),
      });
    },
  );
}
