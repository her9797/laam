import { FetchJsonError, fetchJson } from "@/lib/api/fetch-json";

import type { ExpenseReceipt, ExpenseReceiptInput, ExpenseSummary, ReceiptImageUrl } from "./model";

const RECEIPTS_PATH = "/api/admin/expense-receipts";

function receiptPath(id: string): string {
  return `${RECEIPTS_PATH}/${encodeURIComponent(id)}`;
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function listExpenseReceipts(month: string, categoryId: string | null): Promise<ExpenseReceipt[]> {
  const params = new URLSearchParams({ month });
  if (categoryId) {
    params.set("categoryId", categoryId);
  }
  return fetchJson<ExpenseReceipt[]>(`${RECEIPTS_PATH}?${params}`);
}

export function createExpenseReceipt(input: ExpenseReceiptInput): Promise<ExpenseReceipt> {
  return fetchJson<ExpenseReceipt>(RECEIPTS_PATH, jsonRequest("POST", input));
}

export function updateExpenseReceipt(id: string, input: ExpenseReceiptInput): Promise<ExpenseReceipt> {
  return fetchJson<ExpenseReceipt>(receiptPath(id), jsonRequest("PATCH", input));
}

export function deleteExpenseReceipt(id: string): Promise<void> {
  return fetchJson<void>(receiptPath(id), { method: "DELETE" });
}

export function getExpenseSummary(month: string): Promise<ExpenseSummary> {
  return fetchJson<ExpenseSummary>(`/api/admin/expenses/summary?${new URLSearchParams({ month })}`);
}

export function getExpenseReceiptImageUrl(id: string): Promise<ReceiptImageUrl> {
  return fetchJson<ReceiptImageUrl>(`${receiptPath(id)}/image-url`);
}

/** Multipart field `image`; the browser sets the multipart Content-Type. */
export function uploadExpenseReceiptImage(id: string, image: File): Promise<ExpenseReceipt> {
  const body = new FormData();
  body.append("image", image, image.name);
  return fetchJson<ExpenseReceipt>(`${receiptPath(id)}/image`, { method: "POST", body });
}

/** 503 from any image endpoint: the photo store is not configured. */
export function isImageStorageUnavailable(error: unknown): boolean {
  return error instanceof FetchJsonError && error.status === 503;
}

export type ImageUploadResult =
  | { status: "uploaded"; receipt: ExpenseReceipt }
  | { status: "unavailable" }
  | { status: "failed"; error: unknown };

/**
 * Uploads a photo for a receipt that is already saved. Never throws: the
 * receipt itself stays saved whatever happens to the photo, so the caller
 * only needs to tell the operator which case it was.
 */
export async function uploadReceiptImageSafely(id: string, image: File): Promise<ImageUploadResult> {
  try {
    return { status: "uploaded", receipt: await uploadExpenseReceiptImage(id, image) };
  } catch (error) {
    return isImageStorageUnavailable(error) ? { status: "unavailable" } : { status: "failed", error };
  }
}
