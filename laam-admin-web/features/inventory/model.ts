/**
 * Types mirror the admin inventory/expense-category contract served by
 * `laam-api` under `/api/v1/admin` (reached through the `/api/admin/*` BFF).
 * Quantities and prices are integers; timestamps are RFC3339 UTC strings.
 */

export type ExpenseCategory = {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
};

export type InventoryItem = {
  id: string;
  name: string;
  categoryId: string;
  unit: string;
  quantity: number;
  minQuantity: number;
  isArchived: boolean;
  needsReorder: boolean;
  needsCheck: boolean;
  lastUnitPrice: number | null;
  lastPurchasedAt: string | null;
  updatedAt: string;
};

export type InventoryAdjustmentReason = "purchase" | "receipt_edit" | "receipt_delete" | "manual";

export type InventoryAdjustment = {
  id: string;
  itemId: string;
  delta: number;
  quantityAfter: number;
  reason: InventoryAdjustmentReason;
  receiptId: string | null;
  createdAt: string;
};

export type CreateInventoryItemInput = {
  name: string;
  categoryId: string;
  unit: string;
  quantity: number;
  minQuantity: number;
};

export type UpdateInventoryItemInput = Partial<{
  name: string;
  categoryId: string;
  unit: string;
  minQuantity: number;
  isArchived: boolean;
}>;

export type AdjustInventoryInput = { delta: number } | { set: number };

/**
 * Translation keys (in the `inventory` namespace) for the unit suggestion
 * chips. The chip writes the translated text into the unit field, so the
 * stored unit reads naturally in the operator's language.
 */
export const UNIT_SUGGESTION_KEYS = [
  "unitBottle",
  "unitPiece",
  "unitCan",
  "unitBox",
  "unitKg",
  "unitRoll",
] as const;

/**
 * Applies a local (optimistic) quantity change, recomputing the two derived
 * flags exactly as the server defines them so the "주문 필요" area reacts
 * immediately.
 */
export function withQuantity(item: InventoryItem, quantity: number): InventoryItem {
  return {
    ...item,
    quantity,
    needsReorder: !item.isArchived && quantity < item.minQuantity,
    needsCheck: quantity < 0,
  };
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function filterInventoryItems(
  items: InventoryItem[],
  { categoryId, search }: { categoryId: string | null; search: string },
): InventoryItem[] {
  const query = normalizeSearch(search);
  return items.filter(
    (item) =>
      (categoryId === null || item.categoryId === categoryId) &&
      (query === "" || item.name.toLocaleLowerCase().includes(query)),
  );
}

/**
 * Combobox order: most recently purchased first (never-purchased last), then
 * by name.
 */
export function sortByRecentPurchase(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((a, b) => {
    if (a.lastPurchasedAt !== b.lastPurchasedAt) {
      if (a.lastPurchasedAt === null) return 1;
      if (b.lastPurchasedAt === null) return -1;
      const byTime = Date.parse(b.lastPurchasedAt) - Date.parse(a.lastPurchasedAt);
      if (byTime !== 0) return byTime;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Parses a whole, non-negative quantity typed by the operator. Returns
 * `null` for anything else so the caller can show a validation message.
 */
export function parseQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
