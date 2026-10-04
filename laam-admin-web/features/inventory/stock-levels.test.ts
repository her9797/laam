import { describe, expect, it } from "vitest";

import type { InventoryItem } from "./model";
import { buildStockLevels } from "./stock-levels";

function item(over: Partial<InventoryItem>): InventoryItem {
  const quantity = over.quantity ?? 10;
  const minQuantity = over.minQuantity ?? 10;
  return {
    id: over.name ?? "i",
    name: "item",
    categoryId: "c",
    unit: "개",
    isArchived: false,
    needsReorder: quantity < minQuantity,
    needsCheck: quantity < 0,
    lastUnitPrice: null,
    lastPurchasedAt: null,
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
    quantity,
    minQuantity,
  };
}

describe("buildStockLevels", () => {
  it("computes ratio and status", () => {
    const levels = buildStockLevels([
      item({ name: "a", quantity: 20, minQuantity: 10 }),
      item({ name: "b", quantity: 5, minQuantity: 10 }),
      item({ name: "c", quantity: -2, minQuantity: 10 }),
    ]);
    expect(levels.map((l) => [l.name, l.ratio, l.status])).toEqual([
      ["c", -0.2, "check"],
      ["b", 0.5, "reorder"],
      ["a", 2, "ok"],
    ]);
  });

  it("keeps every item, putting items without a minimum quantity last as unset", () => {
    const levels = buildStockLevels([
      item({ name: "a", quantity: 5, minQuantity: 0, needsReorder: false }),
      item({ name: "b", quantity: 5, minQuantity: 10 }),
      item({ name: "c", quantity: 50, minQuantity: 10 }),
    ]);
    expect(levels.map((l) => [l.name, l.status, l.ratio])).toEqual([
      ["b", "reorder", 0.5],
      ["c", "ok", 5],
      ["a", "unset", null],
    ]);
  });

  it("orders by status (check, reorder, ok, unset), then ratio, then name", () => {
    const levels = buildStockLevels([
      item({ name: "ok-low", quantity: 10, minQuantity: 10 }),
      item({ name: "ok-high", quantity: 30, minQuantity: 10 }),
      item({ name: "unset-b", quantity: 1, minQuantity: 0, needsReorder: false }),
      item({ name: "unset-a", quantity: 1, minQuantity: 0, needsReorder: false }),
      item({ name: "re-z", quantity: 5, minQuantity: 10 }),
      item({ name: "re-a", quantity: 5, minQuantity: 10 }),
      item({ name: "re-low", quantity: 1, minQuantity: 10 }),
      item({ name: "chk", quantity: -3, minQuantity: 10 }),
    ]);
    expect(levels.map((l) => l.name)).toEqual([
      "chk", "re-low", "re-a", "re-z", "ok-low", "ok-high", "unset-a", "unset-b",
    ]);
  });

  it("flags a negative quantity as check even without a minimum quantity", () => {
    const [level] = buildStockLevels([item({ name: "a", quantity: -1, minQuantity: 0 })]);
    expect(level.status).toBe("check");
  });
});
