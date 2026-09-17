"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { inventoryKeys } from "@/features/inventory/queries";

import {
  createExpenseReceipt,
  deleteExpenseReceipt,
  getExpenseReceiptImageUrl,
  getExpenseSummary,
  listExpenseReceipts,
  updateExpenseReceipt,
} from "./api";
import type { ExpenseReceiptInput } from "./model";

export const expenseKeys = {
  all: ["expenses"] as const,
  receipts: (month: string, categoryId: string | null) =>
    [...expenseKeys.all, "receipts", { month, categoryId }] as const,
  summary: (month: string) => [...expenseKeys.all, "summary", month] as const,
  imageUrl: (receiptId: string) => [...expenseKeys.all, "image-url", receiptId] as const,
};

export function useExpenseReceiptsQuery(month: string, categoryId: string | null = null) {
  return useQuery({
    queryKey: expenseKeys.receipts(month, categoryId),
    queryFn: () => listExpenseReceipts(month, categoryId),
  });
}

export function useExpenseSummaryQuery(month: string) {
  return useQuery({
    queryKey: expenseKeys.summary(month),
    queryFn: () => getExpenseSummary(month),
  });
}

export function useReceiptImageUrlQuery(receiptId: string | null) {
  return useQuery({
    queryKey: expenseKeys.imageUrl(receiptId ?? ""),
    queryFn: () => getExpenseReceiptImageUrl(receiptId ?? ""),
    enabled: receiptId !== null,
    // Signed URLs expire after 5 minutes; always ask for a fresh one.
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

/**
 * A receipt changes the monthly totals, the lists, and — through its item
 * lines — inventory quantities, the reorder list and the dashboard's
 * inventory summary, so every one of those is re-fetched.
 */
export function invalidateAfterReceiptChange(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: expenseKeys.all }),
    queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
  ]);
}

export function useSaveExpenseReceiptMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: ExpenseReceiptInput }) =>
      id ? updateExpenseReceipt(id, input) : createExpenseReceipt(input),
    onSuccess: () => {
      void invalidateAfterReceiptChange(queryClient);
    },
  });
}

export function useDeleteExpenseReceiptMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteExpenseReceipt(id),
    onSuccess: () => {
      void invalidateAfterReceiptChange(queryClient);
    },
  });
}
