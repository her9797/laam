import type { InventoryItem } from "./model";

export type StockLevelStatus = "check" | "reorder" | "ok" | "unset";

export type StockLevel = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  minQuantity: number;
  /** quantity / minQuantity, or null when no positive minimum quantity is set. */
  ratio: number | null;
  status: StockLevelStatus;
};

const STATUS_RANK: Record<StockLevelStatus, number> = { check: 0, reorder: 1, ok: 2, unset: 3 };

/**
 * One status per item. A negative quantity (check) wins first, then a missing
 * minimum quantity (unset, no baseline to compare against), then reorder.
 */
export function classifyStock(item: InventoryItem): StockLevelStatus {
  if (item.needsCheck) return "check";
  if (item.minQuantity <= 0) return "unset";
  if (item.needsReorder) return "reorder";
  return "ok";
}

/**
 * Builds the full level list: check, reorder, ok, then unset; within a status
 * the lowest ratio first, then by name.
 */
export function buildStockLevels(items: InventoryItem[]): StockLevel[] {
  return items
    .map((item): StockLevel => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      ratio: item.minQuantity > 0 ? item.quantity / item.minQuantity : null,
      status: classifyStock(item),
    }))
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        (a.ratio ?? 0) - (b.ratio ?? 0) ||
        a.name.localeCompare(b.name),
    );
}
