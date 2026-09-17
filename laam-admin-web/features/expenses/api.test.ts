import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/fetch-json", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/fetch-json")>(
    "@/lib/api/fetch-json",
  );
  return { ...actual, fetchJson: vi.fn() };
});

import { FetchJsonError, fetchJson } from "@/lib/api/fetch-json";

import {
  createExpenseReceipt,
  deleteExpenseReceipt,
  getExpenseReceiptImageUrl,
  getExpenseSummary,
  listExpenseReceipts,
  updateExpenseReceipt,
  uploadExpenseReceiptImage,
  uploadReceiptImageSafely,
} from "./api";
import type { ExpenseReceiptInput } from "./model";

const fetchJsonMock = vi.mocked(fetchJson);

afterEach(() => {
  fetchJsonMock.mockReset();
});

const INPUT: ExpenseReceiptInput = {
  date: "2026-09-17",
  vendor: "마트",
  paymentMethod: "card",
  memo: "",
  lines: [
    { itemId: "gin", quantity: 2, amount: 64000 },
    { categoryId: "other", description: "얼음", amount: 5000 },
  ],
};

describe("expenses api", () => {
  it("lists receipts for a month with an optional category filter", async () => {
    fetchJsonMock.mockResolvedValue([]);
    await listExpenseReceipts("2026-09", null);
    expect(fetchJsonMock).toHaveBeenLastCalledWith("/api/admin/expense-receipts?month=2026-09");
    await listExpenseReceipts("2026-09", "liquor");
    expect(fetchJsonMock).toHaveBeenLastCalledWith(
      "/api/admin/expense-receipts?month=2026-09&categoryId=liquor",
    );
  });

  it("creates, updates and deletes a receipt", async () => {
    fetchJsonMock.mockResolvedValue({});
    await createExpenseReceipt(INPUT);
    expect(fetchJsonMock).toHaveBeenLastCalledWith("/api/admin/expense-receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(INPUT),
    });
    await updateExpenseReceipt("r1", INPUT);
    expect(fetchJsonMock).toHaveBeenLastCalledWith("/api/admin/expense-receipts/r1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(INPUT),
    });
    await deleteExpenseReceipt("r1");
    expect(fetchJsonMock).toHaveBeenLastCalledWith("/api/admin/expense-receipts/r1", {
      method: "DELETE",
    });
  });

  it("reads the monthly summary and the photo URL", async () => {
    fetchJsonMock.mockResolvedValue({});
    await getExpenseSummary("2026-09");
    expect(fetchJsonMock).toHaveBeenLastCalledWith("/api/admin/expenses/summary?month=2026-09");
    await getExpenseReceiptImageUrl("r1");
    expect(fetchJsonMock).toHaveBeenLastCalledWith("/api/admin/expense-receipts/r1/image-url");
  });

  it("uploads the photo as the multipart field 'image'", async () => {
    fetchJsonMock.mockResolvedValue({});
    await uploadExpenseReceiptImage("r1", new File(["x"], "receipt.jpg", { type: "image/jpeg" }));
    const [path, init] = fetchJsonMock.mock.lastCall ?? [];
    expect(path).toBe("/api/admin/expense-receipts/r1/image");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toBeUndefined();
    const body = init?.body as FormData;
    expect((body.get("image") as File).name).toBe("receipt.jpg");
  });
});

describe("uploadReceiptImageSafely", () => {
  const photo = new File(["x"], "receipt.jpg", { type: "image/jpeg" });

  it("reports a missing photo store (503) without throwing", async () => {
    fetchJsonMock.mockRejectedValue(new FetchJsonError(503, "storage not configured"));
    await expect(uploadReceiptImageSafely("r1", photo)).resolves.toEqual({ status: "unavailable" });
  });

  it("reports any other failure with its error", async () => {
    const error = new FetchJsonError(413, "too large");
    fetchJsonMock.mockRejectedValue(error);
    await expect(uploadReceiptImageSafely("r1", photo)).resolves.toEqual({ status: "failed", error });
  });

  it("returns the updated receipt on success", async () => {
    const updated = { id: "r1", hasImage: true };
    fetchJsonMock.mockResolvedValue(updated);
    await expect(uploadReceiptImageSafely("r1", photo)).resolves.toEqual({
      status: "uploaded",
      receipt: updated,
    });
  });
});
