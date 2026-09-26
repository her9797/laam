import { describe, expect, it } from "vitest";

import i18n from "@/i18n/client";

import { mergePaymentMethodStats, paymentMethodLabel } from "./payment-method";

const t = i18n.getFixedT("ko", "orders");

describe("paymentMethodLabel", () => {
  it.each([
    ["CARD", "카드"],
    ["CASH", "현금"],
    ["ACCOUNT_TRANSFER", "계좌이체"],
    ["BARCODE", "간편결제"],
    ["PREPAID_VALUE", "선불결제"],
    ["EXTERNAL", "외부결제"],
    ["POS", "POS(미확인)"],
    ["UNDEFINED", "미확인"],
    ["", "미확인"],
  ])("labels %j as %j", (method, label) => {
    expect(paymentMethodLabel(method, t)).toBe(label);
  });

  it("labels a missing method as unconfirmed", () => {
    expect(paymentMethodLabel(undefined, t)).toBe("미확인");
  });

  it.each(["카드", "간편결제", "SOMETHING_NEW"])("passes an unknown value %j through unchanged", (method) => {
    expect(paymentMethodLabel(method, t)).toBe(method);
  });

  it("uses the English copy when the English translator is passed", () => {
    const en = i18n.getFixedT("en", "orders");
    expect(paymentMethodLabel("CARD", en)).toBe("Card");
    expect(paymentMethodLabel("UNDEFINED", en)).toBe("Unconfirmed");
  });
});

describe("mergePaymentMethodStats", () => {
  it("merges every unconfirmed spelling into one entry, summing revenue and order count", () => {
    const merged = mergePaymentMethodStats([
      { paymentMethod: "CARD", revenue: 15000, orderCount: 3 },
      { paymentMethod: "UNDEFINED", revenue: 4000, orderCount: 2 },
      { paymentMethod: "", revenue: 3000, orderCount: 1 },
      { paymentMethod: "   ", revenue: 1000, orderCount: 1 },
      { paymentMethod: null, revenue: 500, orderCount: 1 },
      { paymentMethod: undefined, revenue: 250, orderCount: 1 },
    ]);

    expect(merged).toEqual([
      { paymentMethod: "CARD", revenue: 15000, orderCount: 3 },
      { paymentMethod: "UNDEFINED", revenue: 8750, orderCount: 6 },
    ]);
  });

  it("re-sorts by revenue descending after merging", () => {
    const merged = mergePaymentMethodStats([
      { paymentMethod: "CARD", revenue: 15000, orderCount: 3 },
      { paymentMethod: "CASH", revenue: 5000, orderCount: 1 },
      { paymentMethod: "UNDEFINED", revenue: 4000, orderCount: 1 },
      { paymentMethod: "", revenue: 3000, orderCount: 1 },
    ]);

    expect(merged.map((row) => [row.paymentMethod, row.revenue])).toEqual([
      ["CARD", 15000],
      ["UNDEFINED", 7000],
      ["CASH", 5000],
    ]);
  });

  it("keeps distinct known and pass-through values separate and does not mutate the input", () => {
    const input = [
      { paymentMethod: "CARD", revenue: 2000, orderCount: 1 },
      { paymentMethod: "POS", revenue: 2000, orderCount: 1 },
      { paymentMethod: "카드", revenue: 1000, orderCount: 1 },
    ];
    const snapshot = structuredClone(input);

    expect(mergePaymentMethodStats(input)).toEqual(input);
    expect(input).toEqual(snapshot);
  });
});
