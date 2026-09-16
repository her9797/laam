import { describe, expect, it } from "vitest";

import type { OrderPageResult, PaymentOrder } from "@/features/orders/model";

import { toOrderNotifications } from "./order-selectors";

function order(overrides: Partial<PaymentOrder> & { orderId: string }): PaymentOrder {
  return {
    menuItemName: "하우스 하이볼",
    categoryName: "하이볼",
    tableNumber: "7",
    requestNote: "",
    amount: 10000,
    vat: 909,
    suppliedAmount: 9091,
    taxFreeAmount: 0,
    status: "DONE",
    posSyncStatus: "SUCCEEDED",
    createdAt: "2026-09-04T10:00:00Z",
    approvedAt: "2026-09-04T10:00:30Z",
    ...overrides,
  };
}

function page(items: PaymentOrder[]): OrderPageResult {
  return { items, page: 1, pageSize: 20, total: items.length };
}

describe("toOrderNotifications", () => {
  it("maps a completed order onto the alarm shape, keyed by orderId", () => {
    const result = toOrderNotifications(page([order({ orderId: "o1" })]));

    expect(result).toEqual([
      {
        id: "o1",
        tableNumber: "7",
        menuItemName: "하우스 하이볼",
        amount: 10000,
        approvedAt: "2026-09-04T10:00:30Z",
      },
    ]);
  });

  it("excludes orders that are not paid yet", () => {
    const result = toOrderNotifications(
      page([
        order({ orderId: "ready", status: "READY", approvedAt: undefined }),
        order({ orderId: "done" }),
      ]),
    );

    expect(result.map((item) => item.id)).toEqual(["done"]);
  });

  it("sorts newest first by approval time", () => {
    const result = toOrderNotifications(
      page([
        order({ orderId: "older", approvedAt: "2026-09-04T10:00:00Z" }),
        order({ orderId: "newer", approvedAt: "2026-09-04T11:00:00Z" }),
      ]),
    );

    expect(result.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("falls back to createdAt when a completed order has no approval time", () => {
    const result = toOrderNotifications(
      page([order({ orderId: "o1", approvedAt: undefined, createdAt: "2026-09-04T09:00:00Z" })]),
    );

    expect(result[0]?.approvedAt).toBe("2026-09-04T09:00:00Z");
  });

  it("returns an empty list for an empty page", () => {
    expect(toOrderNotifications(page([]))).toEqual([]);
  });
});
