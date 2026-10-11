import { describe, expect, it } from "vitest";

import { getBillAmounts } from "./amounts";

describe("getBillAmounts", () => {
  it.each([
    ["negative (as TossPlace reports)", -2000, 68000, 2000],
    ["zero", 0, 66000, 0],
    ["null (charge not recorded yet)", null, 66000, null],
    ["positive (defensive)", 2000, 68000, 2000],
  ] as const)("derives total and discount for a %s discount", (_name, discountAmount, total, discount) => {
    expect(getBillAmounts({ totalAmount: 66000, discountAmount, paidAmount: 66000 })).toEqual({
      total,
      discount,
      paid: 66000,
    });
  });
});
