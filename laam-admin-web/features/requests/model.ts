/**
 * Mirrors `laam-api/internal/lamdata.CustomerRequest`. This is the "general
 * request" (`customer_requests`) feature boundary — it must never share a
 * model, API namespace, or query key with `features/special-requests`
 * (`special_requests`), per this repo's `AGENTS.md` rule and the plan's
 * Task 4 brief.
 *
 * "Song request" (Task 5) is not a separate resource: it is the same
 * `CustomerRequest` list, split purely by a `text` prefix convention on the
 * UI layer — it stays on this one model/API/query-key boundary.
 */
export type CustomerRequestStatus = "pending" | "checked" | "completed";

export type CustomerRequest = {
  id: string;
  tableNumber: string;
  text: string;
  status: CustomerRequestStatus;
  createdAt: string;
  handledAt?: string;
};

/** "all" delegates the general/song split to the server's `[노래 신청]` prefix
 * check (`laam-api/internal/store/postgres.go`'s `songRequestPrefix`), rather
 * than reimplementing it here — see `features/dashboard/summary.ts`'s doc
 * comment for why that rule must stay in exactly one place per app. */
export type CustomerRequestKind = "all" | "general" | "song";

export type CustomerRequestSort = "status" | "createdAt" | "tableNumber";

export type SortOrder = "asc" | "desc";

/**
 * `dateFrom`/`dateTo` are date-only (`YYYY-MM-DD`) strings, resolved to
 * absolute calendar-day-bounded instants at fetch time — see
 * `@/lib/date-range.ts`. Both blank means "no date bound"; the screen's
 * own mount effect fills in the default 7-day range once, client-side
 * (see `RequestListPage`), so in practice both are populated after first
 * render.
 */
export type CustomerRequestListQuery = {
  page: number;
  pageSize: number;
  status?: CustomerRequestStatus;
  kind: CustomerRequestKind;
  search: string;
  dateFrom: string;
  dateTo: string;
  sort: CustomerRequestSort;
  order: SortOrder;
};

/** Mirrors `laam-api/internal/lamdata.CustomerRequestPage`. */
export type CustomerRequestPageResult = {
  items: CustomerRequest[];
  page: number;
  pageSize: number;
  total: number;
};
