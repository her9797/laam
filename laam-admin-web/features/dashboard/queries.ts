"use client";

import { useQuery } from "@tanstack/react-query";

import { inventoryKeys } from "@/features/inventory/queries";
import { fetchJson } from "@/lib/api/fetch-json";

export type InventorySummary = { reorderCount: number; needsCheckCount: number };

export function fetchInventorySummary(): Promise<InventorySummary> {
  return fetchJson<InventorySummary>("/api/admin/inventory/summary");
}

// Under `inventoryKeys.all`, so receipt saves and quantity changes that
// invalidate inventory also refresh this count.
export const inventorySummaryKey = [...inventoryKeys.all, "summary"] as const;

export function useInventorySummaryQuery() {
  return useQuery({ queryKey: inventorySummaryKey, queryFn: fetchInventorySummary });
}
