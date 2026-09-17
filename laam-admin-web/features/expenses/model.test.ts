import { describe, expect, it } from "vitest";

import {
  calculateDraftTotal,
  compareWithPreviousMonth,
  diffInventoryQuantities,
  formatAmountInput,
  groupReceiptsByDate,
  parseAmountInput,
  parseMonthParam,
  recentVendors,
  seoulMonth,
  seoulToday,
  shiftMonth,
  type DraftLine,
  type ExpenseReceipt,
} from "./model";

function receipt(overrides: Partial<ExpenseReceipt>): ExpenseReceipt {
  return {
    id: "r",
    date: "2026-09-17",
    vendor: "",
    paymentMethod: "card",
    memo: "",
    total: 0,
    hasImage: false,
    lines: [],
    createdAt: "2026-09-17T01:00:00Z",
    updatedAt: "2026-09-17T01:00:00Z",
    ...overrides,
  };
}

describe("calculateDraftTotal", () => {
  it("adds every line amount and treats a blank amount as 0", () => {
    const lines: DraftLine[] = [
      { key: "a", kind: "item", itemId: "gin", quantity: 2, amount: "64,000" },
      { key: "b", kind: "other", categoryId: "other", description: "얼음", amount: "5000" },
      { key: "c", kind: "item", itemId: null, quantity: 1, amount: "" },
    ];
    expect(calculateDraftTotal(lines)).toBe(69000);
  });

  it("is 0 with no lines", () => {
    expect(calculateDraftTotal([])).toBe(0);
  });
});

describe("amount input", () => {
  it("formats digits with thousands separators while typing", () => {
    expect(formatAmountInput("1234567")).toBe("1,234,567");
    expect(formatAmountInput("12,34a5")).toBe("12,345");
    expect(formatAmountInput("0012")).toBe("12");
    expect(formatAmountInput("")).toBe("");
    expect(formatAmountInput("0")).toBe("0");
  });

  it("parses a formatted amount and rejects anything else", () => {
    expect(parseAmountInput("1,234")).toBe(1234);
    expect(parseAmountInput("0")).toBe(0);
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("-5")).toBeNull();
    expect(parseAmountInput("1.5")).toBeNull();
  });
});

describe("compareWithPreviousMonth", () => {
  it("reports less, more, or same with the absolute difference", () => {
    expect(compareWithPreviousMonth(368000, 500000)).toEqual({ kind: "less", difference: 132000 });
    expect(compareWithPreviousMonth(632000, 500000)).toEqual({ kind: "more", difference: 132000 });
    expect(compareWithPreviousMonth(500000, 500000)).toEqual({ kind: "same", difference: 0 });
  });
});

describe("diffInventoryQuantities", () => {
  it("returns the per-item change between old and new lines, skipping unchanged items", () => {
    const before = [
      { itemId: "gin", quantity: 2 },
      { itemId: "lime", quantity: 10 },
      { itemId: null, quantity: null },
      { itemId: "gin", quantity: 1 },
      { itemId: "tonic", quantity: 4 },
    ];
    const after = [
      { itemId: "gin", quantity: 5 },
      { itemId: "tonic", quantity: 4 },
      { itemId: "soda", quantity: 6 },
    ];
    expect(diffInventoryQuantities(before, after)).toEqual([
      { itemId: "gin", delta: 2 },
      { itemId: "lime", delta: -10 },
      { itemId: "soda", delta: 6 },
    ]);
  });

  it("treats a new receipt as all additions and a deletion as all subtractions", () => {
    const lines = [{ itemId: "gin", quantity: 3 }];
    expect(diffInventoryQuantities([], lines)).toEqual([{ itemId: "gin", delta: 3 }]);
    expect(diffInventoryQuantities(lines, [])).toEqual([{ itemId: "gin", delta: -3 }]);
  });
});

describe("months and dates in store time", () => {
  it("uses the Asia/Seoul calendar", () => {
    // 2026-08-31 16:30 UTC is already 2026-09-01 01:30 in Seoul.
    const now = new Date("2026-08-31T16:30:00Z");
    expect(seoulToday(now)).toBe("2026-09-01");
    expect(seoulMonth(now)).toBe("2026-09");
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-09", 0)).toBe("2026-09");
  });

  it("accepts only a valid YYYY-MM month param", () => {
    expect(parseMonthParam("2026-09")).toBe("2026-09");
    expect(parseMonthParam("2026-13")).toBeNull();
    expect(parseMonthParam("2026-9")).toBeNull();
    expect(parseMonthParam(null)).toBeNull();
  });
});

describe("receipt list helpers", () => {
  it("groups receipts by date keeping the server order", () => {
    const receipts = [
      receipt({ id: "a", date: "2026-09-17" }),
      receipt({ id: "b", date: "2026-09-17" }),
      receipt({ id: "c", date: "2026-09-15" }),
    ];
    expect(groupReceiptsByDate(receipts)).toEqual([
      { date: "2026-09-17", receipts: [receipts[0], receipts[1]] },
      { date: "2026-09-15", receipts: [receipts[2]] },
    ]);
  });

  it("extracts distinct recent vendors, newest first, ignoring blanks", () => {
    const receipts = [
      receipt({ vendor: "코스트코 " }),
      receipt({ vendor: "" }),
      receipt({ vendor: "마트" }),
      receipt({ vendor: "코스트코" }),
      receipt({ vendor: "시장" }),
    ];
    expect(recentVendors(receipts, 2)).toEqual(["코스트코", "마트"]);
  });
});
