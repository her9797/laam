import { fetchJson } from "@/lib/api/fetch-json";

import { resolveOrderDateRange } from "../order-date-range";
import type { BillDetail, BillListQuery, BillPageResult } from "./model";

const PAYMENT_BILLS_PATH = "/api/admin/payment-bills";

/**
 * Fetches a page of 계산서 (newest `openedAt` first). Date handling matches
 * `../api.ts`'s `fetchOrdersPage`: the picked dates are resolved to
 * business-day bounds on every fetch, and no bound is sent when the pair
 * is blank or invalid.
 */
export function fetchBillsPage(query: BillListQuery): Promise<BillPageResult> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.sourceType) {
    params.set("sourceType", query.sourceType);
  }
  if (query.search.trim()) {
    params.set("q", query.search.trim());
  }

  const range = resolveOrderDateRange(query.dateFrom, query.dateTo);
  if (range.ok) {
    params.set("from", range.from.toISOString());
    params.set("to", range.to.toISOString());
  }

  return fetchJson<BillPageResult>(`${PAYMENT_BILLS_PATH}?${params.toString()}`, {
    method: "GET",
  });
}

/** Fetches one bill with its payments and menu rows; 404 rejects. */
export function fetchBill(billId: string): Promise<BillDetail> {
  return fetchJson<BillDetail>(`${PAYMENT_BILLS_PATH}/${encodeURIComponent(billId)}`, {
    method: "GET",
  });
}
