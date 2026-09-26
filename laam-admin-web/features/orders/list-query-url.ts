import { PAGE_SIZE_OPTIONS } from "@/components/list/Pagination";

import type { BillListQuery, BillStatus } from "./bills/model";
import type {
  OrderListQuery,
  PaymentOrderPosSyncStatus,
  PaymentOrderSort,
  PaymentOrderStatus,
  SortOrder,
} from "./model";

/**
 * URL <-> `OrderListQuery` codec for the `/orders` screen. This list carries
 * no personal customer data (see `SpecialRequestPage`'s doc comment for the
 * contrasting case that keeps its search out of the URL on purpose), so
 * it's safe to sync to the address bar/browser history the same way
 * `features/requests/list-query-url.ts` does.
 *
 * `dateFrom`/`dateTo` — date-only `YYYY-MM-DD` strings, not an absolute
 * instant range — are what's stored in the URL. They're resolved to an
 * absolute business-day-bounded range at fetch time
 * (`features/orders/api.ts`/`./order-date-range.ts`). There is no fixed
 * "default" value for these two (the screen's own 7-day default shifts
 * with the clock), so unlike every other field here they're written to the
 * URL whenever set rather than omitted at a hardcoded default.
 */
const DEFAULT_PAGE_SIZE = 10;
// No status filter (all statuses) is the default view of `/orders`.
const DEFAULT_STATUS: PaymentOrderStatus | undefined = undefined;
const DEFAULT_SORT: PaymentOrderSort = "createdAt";

const VALID_STATUSES: PaymentOrderStatus[] = ["READY", "ACKNOWLEDGED", "DONE", "CANCELLED"];
const VALID_POS_SYNC_STATUSES: PaymentOrderPosSyncStatus[] = [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "NOT_CONFIGURED",
];
const VALID_SORTS: PaymentOrderSort[] = ["createdAt", "amount"];
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidStatus(value: string | null): value is PaymentOrderStatus {
  return VALID_STATUSES.includes(value as PaymentOrderStatus);
}

function isValidPosSyncStatus(value: string | null): value is PaymentOrderPosSyncStatus {
  return VALID_POS_SYNC_STATUSES.includes(value as PaymentOrderPosSyncStatus);
}

function isValidSort(value: string | null): value is PaymentOrderSort {
  return VALID_SORTS.includes(value as PaymentOrderSort);
}

function parseDateOnlyParam(value: string | null): string {
  return value && DATE_ONLY_PATTERN.test(value) ? value : "";
}

function parsePageSize(value: string | null): number {
  const parsed = Number(value);
  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])
    ? parsed
    : DEFAULT_PAGE_SIZE;
}

export function parseOrderListQuery(searchParams: URLSearchParams): OrderListQuery {
  const pageRaw = Number(searchParams.get("page"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const statusRaw = searchParams.get("status");
  const status = isValidStatus(statusRaw) ? statusRaw : DEFAULT_STATUS;

  const posSyncRaw = searchParams.get("posSync");
  const posSyncStatus = isValidPosSyncStatus(posSyncRaw) ? posSyncRaw : undefined;

  const sortRaw = searchParams.get("sort");
  const sort = isValidSort(sortRaw) ? sortRaw : DEFAULT_SORT;

  const orderRaw = searchParams.get("order");
  const order: SortOrder = orderRaw === "asc" || orderRaw === "desc" ? orderRaw : "desc";

  return {
    page,
    pageSize: parsePageSize(searchParams.get("pageSize")),
    status,
    posSyncStatus,
    search: searchParams.get("q") ?? "",
    dateFrom: parseDateOnlyParam(searchParams.get("dateFrom")),
    dateTo: parseDateOnlyParam(searchParams.get("dateTo")),
    sort,
    order,
  };
}

/**
 * Serializes only what departs from the default, so the URL for the
 * default view of the list (no status filter) stays a bare pathname.
 */
export function buildOrderListSearchParams(query: OrderListQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.page !== 1) {
    params.set("page", String(query.page));
  }
  if (query.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(query.pageSize));
  }
  if (query.status !== DEFAULT_STATUS) {
    params.set("status", query.status ?? "all");
  }
  if (query.posSyncStatus) {
    params.set("posSync", query.posSyncStatus);
  }
  if (query.search) {
    params.set("q", query.search);
  }
  if (query.dateFrom) {
    params.set("dateFrom", query.dateFrom);
  }
  if (query.dateTo) {
    params.set("dateTo", query.dateTo);
  }
  if (query.sort !== DEFAULT_SORT) {
    params.set("sort", query.sort);
  }
  if (query.order !== "desc") {
    params.set("order", query.order);
  }

  return params;
}

/**
 * `/orders` has two views of the same history: one row per menu item
 * (`menu`, the original list and the default) and one row per 계산서
 * (`bill`). The view is a URL param too, but `menu` is omitted so every
 * link/bookmark made before the toggle existed still means the same list.
 *
 * Date range, search, page size, and page are shared by both views and keep
 * their existing param names. Each view only writes its own filters:
 * `status`/`posSync`/`sort`/`order` in `menu`, `billStatus`/`source` in
 * `bill`.
 */
export type OrderListView = "menu" | "bill";

/** TossPlace `PaymentSourceType` values offered as the bill 결제수단 filter. */
export const BILL_SOURCE_TYPES = [
  "CARD",
  "CASH",
  "ACCOUNT_TRANSFER",
  "BARCODE",
  "PREPAID_VALUE",
  "EXTERNAL",
] as const;
export type BillSourceType = (typeof BILL_SOURCE_TYPES)[number];

export const BILL_STATUSES: readonly BillStatus[] = ["OPEN", "PAID", "CANCELLED"];

export type OrderListUrlState = {
  view: OrderListView;
  /** Menu-view query; its paging/search/date fields are shared with the bill view. */
  query: OrderListQuery;
  billStatus?: BillStatus;
  billSource?: BillSourceType;
};

const DEFAULT_VIEW: OrderListView = "menu";
const MENU_ONLY_PARAMS = ["status", "posSync", "sort", "order"];

function isValidBillStatus(value: string | null): value is BillStatus {
  return BILL_STATUSES.includes(value as BillStatus);
}

function isValidBillSource(value: string | null): value is BillSourceType {
  return BILL_SOURCE_TYPES.includes(value as BillSourceType);
}

export function parseOrderListUrlState(searchParams: URLSearchParams): OrderListUrlState {
  const billStatusRaw = searchParams.get("billStatus");
  const billSourceRaw = searchParams.get("source");
  return {
    view: searchParams.get("view") === "bill" ? "bill" : DEFAULT_VIEW,
    query: parseOrderListQuery(searchParams),
    billStatus: isValidBillStatus(billStatusRaw) ? billStatusRaw : undefined,
    billSource: isValidBillSource(billSourceRaw) ? billSourceRaw : undefined,
  };
}

export function buildOrderListUrlSearchParams(state: OrderListUrlState): URLSearchParams {
  const params = buildOrderListSearchParams(state.query);
  if (state.view === DEFAULT_VIEW) {
    return params;
  }

  for (const name of MENU_ONLY_PARAMS) {
    params.delete(name);
  }
  params.set("view", state.view);
  if (state.billStatus) {
    params.set("billStatus", state.billStatus);
  }
  if (state.billSource) {
    params.set("source", state.billSource);
  }
  return params;
}

export function toBillListQuery(state: OrderListUrlState): BillListQuery {
  return {
    page: state.query.page,
    pageSize: state.query.pageSize,
    status: state.billStatus,
    sourceType: state.billSource,
    search: state.query.search,
    dateFrom: state.query.dateFrom,
    dateTo: state.query.dateTo,
  };
}
