/**
 * Mirrors `laam-api/internal/lamdata.PaymentOrderStats` and its nested
 * types. Aggregated over DONE orders only, within a caller-supplied
 * `[from, to)` range — see `laam-api`'s `store.Repository.GetPaymentOrderStats`
 * doc comment for the bucketing/timezone rules.
 */
export type SalesStatsSummary = {
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
};

export type TrendUnit = "day" | "week" | "month";

export type TrendBucket = {
  bucket: string;
  revenue: number;
  orderCount: number;
};

export type SalesTrend = {
  unit: TrendUnit;
  buckets: TrendBucket[];
};

export type CategoryStat = {
  categoryName: string;
  revenue: number;
  orderCount: number;
};

export type PaymentMethodStat = {
  paymentMethod: string;
  revenue: number;
  orderCount: number;
};

export type TableStat = {
  tableNumber: string;
  revenue: number;
  orderCount: number;
};

/**
 * Mirrors `laam-api/internal/lamdata.PaymentOrderMenuItemStat` — grouped by
 * `menuItemName` (a snapshot taken at purchase time), not a menu item id,
 * so a deleted product's past sales stay attributable. See that Go type's
 * doc comment.
 */
export type MenuItemStat = {
  menuItemName: string;
  revenue: number;
  orderCount: number;
};

export type SalesStats = {
  summary: SalesStatsSummary;
  trend: SalesTrend;
  byCategory: CategoryStat[];
  byPaymentMethod: PaymentMethodStat[];
  byTable: TableStat[];
  byMenuItem: MenuItemStat[];
};
