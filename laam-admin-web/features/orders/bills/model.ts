import type { PaymentOrder } from "../model";

/**
 * Mirrors `laam-api/internal/lamdata.POSBill*` — a 계산서 is one TossPlace
 * (POS) order: the menu rows (`payment_orders`) rung onto it plus the
 * payments (`pos_payments`) that settled it. Part of the `payment_orders`
 * admin feature, so it lives under `features/orders`.
 */
export type BillStatus = "OPEN" | "PAID" | "CANCELLED";

/** TossPlace `PaymentState`. */
export type BillPaymentState = "APPROVED" | "CANCELLED" | "UNDEFINED";

/** One payment as summarised on a bill-list row. */
export type BillPaymentSummary = {
  sourceType: string;
  paymentMethod: string;
  amount: number;
  state: BillPaymentState;
};

export type Bill = {
  id: string;
  posOrderId: string;
  tableNumber: string;
  status: BillStatus;
  openedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  /** POS charge when known, otherwise the sum of non-cancelled menu rows. */
  totalAmount: number;
  /** Sum of APPROVED payments. */
  paidAmount: number;
  payments: BillPaymentSummary[];
  menuCount: number;
  menuPreview: string[];
};

export type BillPageResult = {
  items: Bill[];
  page: number;
  pageSize: number;
  total: number;
};

export type BillPayment = {
  id: string;
  state: BillPaymentState;
  sourceType: string;
  paymentMethod: string;
  cardBrand?: string;
  amount: number;
  taxAmount: number;
  supplyAmount: number;
  taxExemptAmount: number;
  approvedNo?: string;
  approvedAt?: string;
  cancelledAt?: string;
};

export type BillDetail = Omit<Bill, "payments" | "menuCount" | "menuPreview"> & {
  /** POS order-level discount; null until the POS charge is recorded. */
  discountAmount: number | null;
  /** Set once the full payment list was fetched; payments may be incomplete until then. */
  paymentsSyncedAt?: string;
  payments: BillPayment[];
  menuItems: PaymentOrder[];
};

/**
 * `dateFrom`/`dateTo` are date-only strings resolved to business-day
 * bounds at fetch time, like `OrderListQuery` (see `../order-date-range.ts`);
 * the server filters bills on `openedAt`.
 */
export type BillListQuery = {
  page: number;
  pageSize: number;
  status?: BillStatus;
  /** TossPlace `PaymentSourceType` — bills with an APPROVED payment of this type. */
  sourceType?: string;
  search: string;
  dateFrom: string;
  dateTo: string;
};
