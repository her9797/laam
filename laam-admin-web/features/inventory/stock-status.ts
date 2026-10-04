import type { InventoryItem } from "./model";
import { classifyStock } from "./stock-levels";

export type StockStatusSummary = {
  ok: number;
  reorder: number;
  check: number;
  /** Items with no minimum quantity: nothing to compare the stock against. */
  unset: number;
  total: number;
};

/** Buckets items into non-overlapping stock statuses; each item is counted once. */
export function summarizeStockStatus(items: InventoryItem[]): StockStatusSummary {
  const summary: StockStatusSummary = { ok: 0, reorder: 0, check: 0, unset: 0, total: items.length };
  for (const item of items) summary[classifyStock(item)] += 1;
  return summary;
}
