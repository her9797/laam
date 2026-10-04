import { describe, expect, it } from "vitest";

import type { InventoryItem } from "./model";
import { summarizeStockStatus } from "./stock-status";

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

describe("summarizeStockStatus", () => {
  it("returns zeros for an empty list", () => {
    expect(summarizeStockStatus([])).toEqual({ ok: 0, reorder: 0, check: 0, unset: 0, total: 0 });
  });

  it("classifies each item into exactly one status", () => {
    const summary = summarizeStockStatus([
      item({ id: "a" }),
      item({ id: "b" }),
      item({ id: "c", quantity: 1, needsReorder: true }),
      item({ id: "d", quantity: -1, needsReorder: true, needsCheck: true }),
    ]);
    expect(summary).toEqual({ ok: 2, reorder: 1, check: 1, unset: 0, total: 4 });
  });

  it("counts items without a minimum quantity as unset, not ok", () => {
    const summary = summarizeStockStatus([
      item({ id: "a" }),
      item({ id: "b", minQuantity: 0 }),
      item({ id: "c", quantity: -1, minQuantity: 0, needsCheck: true }),
    ]);
    expect(summary).toEqual({ ok: 1, reorder: 0, check: 1, unset: 1, total: 3 });
  });
});
