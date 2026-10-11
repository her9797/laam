import type { Bill } from "./model";

export type BillAmounts = {
  /** Pre-discount total: the POS charge plus the discount's magnitude. */
  total: number;
  /** Unsigned discount; null until the POS charge is recorded. */
  discount: number | null;
  paid: number;
};

/**
 * Display amounts shared by the bill list and detail page. `totalAmount` is
 * the POS charge after the order-level discount, which TossPlace reports as
 * a negative number, so the discount's magnitude is added back to the total
 * and shown without a sign.
 */
export function getBillAmounts(bill: Pick<Bill, "totalAmount" | "discountAmount" | "paidAmount">): BillAmounts {
  const discount = bill.discountAmount === null ? null : Math.abs(bill.discountAmount);
  return {
    total: bill.totalAmount + (discount ?? 0),
    discount,
    paid: bill.paidAmount,
  };
}
