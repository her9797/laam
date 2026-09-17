import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/fetch-json", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/fetch-json")>(
    "@/lib/api/fetch-json",
  );
  return { ...actual, fetchJson: vi.fn() };
});

import { fetchJson } from "@/lib/api/fetch-json";

import {
  adjustInventoryItem,
  createExpenseCategory,
  createInventoryItem,
  listExpenseCategories,
  listInventoryAdjustments,
  listInventoryItems,
  renameExpenseCategory,
  updateInventoryItem,
} from "./api";

const fetchJsonMock = vi.mocked(fetchJson);

afterEach(() => {
  fetchJsonMock.mockReset();
});

function jsonInit(method: string, body: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("inventory api", () => {
  it("lists expense categories through the BFF", async () => {
    fetchJsonMock.mockResolvedValue([]);
    await listExpenseCategories();
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/admin/expense-categories");
  });

  it("creates and renames an expense category", async () => {
    fetchJsonMock.mockResolvedValue({});
    await createExpenseCategory("얼음");
    expect(fetchJsonMock).toHaveBeenLastCalledWith(
      "/api/admin/expense-categories",
      jsonInit("POST", { name: "얼음" }),
    );

    await renameExpenseCategory("liquor", "주류");
    expect(fetchJsonMock).toHaveBeenLastCalledWith(
      "/api/admin/expense-categories/liquor",
      jsonInit("PATCH", { name: "주류" }),
    );
  });

  it("lists inventory items with the includeArchived flag", async () => {
    fetchJsonMock.mockResolvedValue([]);
    await listInventoryItems(false);
    expect(fetchJsonMock).toHaveBeenLastCalledWith("/api/admin/inventory-items?includeArchived=false");
    await listInventoryItems(true);
    expect(fetchJsonMock).toHaveBeenLastCalledWith("/api/admin/inventory-items?includeArchived=true");
  });

  it("creates and updates an inventory item", async () => {
    fetchJsonMock.mockResolvedValue({});
    const input = { name: "진", categoryId: "liquor", unit: "병", quantity: 3, minQuantity: 2 };
    await createInventoryItem(input);
    expect(fetchJsonMock).toHaveBeenLastCalledWith("/api/admin/inventory-items", jsonInit("POST", input));

    await updateInventoryItem("item 1", { minQuantity: 4 });
    expect(fetchJsonMock).toHaveBeenLastCalledWith(
      "/api/admin/inventory-items/item%201",
      jsonInit("PATCH", { minQuantity: 4 }),
    );
  });

  it("adjusts an item by delta or to an absolute quantity", async () => {
    fetchJsonMock.mockResolvedValue({});
    await adjustInventoryItem("item-1", { delta: -3 });
    expect(fetchJsonMock).toHaveBeenLastCalledWith(
      "/api/admin/inventory-items/item-1/adjust",
      jsonInit("POST", { delta: -3 }),
    );

    await adjustInventoryItem("item-1", { set: 7 });
    expect(fetchJsonMock).toHaveBeenLastCalledWith(
      "/api/admin/inventory-items/item-1/adjust",
      jsonInit("POST", { set: 7 }),
    );
  });

  it("lists an item's recent adjustments with a limit", async () => {
    fetchJsonMock.mockResolvedValue([]);
    await listInventoryAdjustments("item-1", 20);
    expect(fetchJsonMock).toHaveBeenLastCalledWith(
      "/api/admin/inventory-items/item-1/adjustments?limit=20",
    );
  });
});
