import { describe, expect, it } from "vitest";

import {
  filterInventoryItems,
  parseQuantity,
  sortByRecentPurchase,
  withQuantity,
  type InventoryItem,
} from "./model";

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: "item",
    name: "item",
    categoryId: "liquor",
    unit: "병",
    quantity: 5,
    minQuantity: 2,
    isArchived: false,
    needsReorder: false,
    needsCheck: false,
    lastUnitPrice: null,
    lastPurchasedAt: null,
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("withQuantity", () => {
  it("recomputes needsReorder and needsCheck from the new quantity", () => {
    expect(withQuantity(item({}), 1)).toMatchObject({ quantity: 1, needsReorder: true, needsCheck: false });
    expect(withQuantity(item({}), -1)).toMatchObject({ needsReorder: true, needsCheck: true });
    expect(withQuantity(item({}), 2)).toMatchObject({ needsReorder: false, needsCheck: false });
    expect(withQuantity(item({ isArchived: true }), 0)).toMatchObject({ needsReorder: false });
  });
});

describe("filterInventoryItems", () => {
  const items = [
    item({ id: "a", name: "Gin", categoryId: "liquor" }),
    item({ id: "b", name: "Lime", categoryId: "garnish" }),
  ];

  it("filters by category and case-insensitive search", () => {
    expect(filterInventoryItems(items, { categoryId: "garnish", search: "" }).map((i) => i.id)).toEqual(["b"]);
    expect(filterInventoryItems(items, { categoryId: null, search: " gi " }).map((i) => i.id)).toEqual(["a"]);
    expect(filterInventoryItems(items, { categoryId: null, search: "" })).toHaveLength(2);
  });
});

describe("sortByRecentPurchase", () => {
  it("puts the most recent purchase first, never-purchased last, then by name", () => {
    const sorted = sortByRecentPurchase([
      item({ id: "never-b", name: "b", lastPurchasedAt: null }),
      item({ id: "old", name: "z", lastPurchasedAt: "2026-08-01T00:00:00Z" }),
      item({ id: "never-a", name: "a", lastPurchasedAt: null }),
      item({ id: "new", name: "y", lastPurchasedAt: "2026-09-10T00:00:00Z" }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["new", "old", "never-a", "never-b"]);
  });
});

describe("parseQuantity", () => {
  it("accepts whole non-negative numbers only", () => {
    expect(parseQuantity(" 12 ")).toBe(12);
    expect(parseQuantity("0")).toBe(0);
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("1.5")).toBeNull();
    expect(parseQuantity("abc")).toBeNull();
  });
});
