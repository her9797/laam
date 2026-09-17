import { fetchJson } from "@/lib/api/fetch-json";

import type {
  AdjustInventoryInput,
  CreateInventoryItemInput,
  ExpenseCategory,
  InventoryAdjustment,
  InventoryItem,
  UpdateInventoryItemInput,
} from "./model";

const CATEGORIES_PATH = "/api/admin/expense-categories";
const ITEMS_PATH = "/api/admin/inventory-items";

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function itemPath(id: string): string {
  return `${ITEMS_PATH}/${encodeURIComponent(id)}`;
}

export function listExpenseCategories(): Promise<ExpenseCategory[]> {
  return fetchJson<ExpenseCategory[]>(CATEGORIES_PATH);
}

export function createExpenseCategory(name: string): Promise<ExpenseCategory> {
  return fetchJson<ExpenseCategory>(CATEGORIES_PATH, jsonRequest("POST", { name }));
}

export function renameExpenseCategory(id: string, name: string): Promise<ExpenseCategory> {
  return fetchJson<ExpenseCategory>(
    `${CATEGORIES_PATH}/${encodeURIComponent(id)}`,
    jsonRequest("PATCH", { name }),
  );
}

export function listInventoryItems(includeArchived: boolean): Promise<InventoryItem[]> {
  return fetchJson<InventoryItem[]>(`${ITEMS_PATH}?includeArchived=${includeArchived}`);
}

export function createInventoryItem(input: CreateInventoryItemInput): Promise<InventoryItem> {
  return fetchJson<InventoryItem>(ITEMS_PATH, jsonRequest("POST", input));
}

export function updateInventoryItem(
  id: string,
  input: UpdateInventoryItemInput,
): Promise<InventoryItem> {
  return fetchJson<InventoryItem>(itemPath(id), jsonRequest("PATCH", input));
}

export function adjustInventoryItem(id: string, input: AdjustInventoryInput): Promise<InventoryItem> {
  return fetchJson<InventoryItem>(`${itemPath(id)}/adjust`, jsonRequest("POST", input));
}

export function listInventoryAdjustments(id: string, limit: number): Promise<InventoryAdjustment[]> {
  return fetchJson<InventoryAdjustment[]>(`${itemPath(id)}/adjustments?limit=${limit}`);
}
