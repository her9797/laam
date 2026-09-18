"use client";

import { useQuery } from "@tanstack/react-query";

import { inventoryKeys } from "@/features/inventory/queries";
import { getDatePresetRange } from "@/features/orders/business-day";
import { orderKeys } from "@/features/orders/queries";
import { fetchSalesStats } from "@/features/orders/stats/api";
import type { SalesStatsSummary } from "@/features/orders/stats/model";
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

// Under `orderKeys.all`, so `useOrderBroadcast`'s `new_order`-signal
// invalidation (see that hook's doc comment) also refreshes today's total
// the moment a sale completes, the same way the order-history list does.
export const todaySalesKey = [...orderKeys.all, "stats", "today"] as const;

// Uses `getDatePresetRange("today", reference)` — the business day still
// open at `reference`'s wall-clock time — not `getBusinessDayBoundsForDate`,
// which resolves an arbitrary *picked* calendar date and would show a blank
// window until that evening's 16:00 opening (see business-day.ts's doc
// comments on the two functions for why they differ).
export function fetchTodaySales(reference: Date = new Date()): Promise<SalesStatsSummary> {
  const { from, to } = getDatePresetRange("today", reference);
  return fetchSalesStats(from ?? reference, to ?? reference, "business").then((stats) => stats.summary);
}

export function useTodaySalesQuery() {
  return useQuery({ queryKey: todaySalesKey, queryFn: () => fetchTodaySales() });
}
