"use client";

import "@/i18n/client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { ListToolbar } from "@/components/list/ListToolbar";
import { ListTotalCount } from "@/components/list/ListTotalCount";
import { ListUpdatingRegion } from "@/components/list/ListUpdatingRegion";
import { Pagination } from "@/components/list/Pagination";
import { EmptyState, ErrorState, ListSkeletonState } from "@/components/states/PageStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useRetainedListQuery } from "@/hooks/use-retained-list-query";
import { formatCurrencyKRW, formatDateTime } from "@/lib/utils";

import { BillListView } from "./bills/BillListView";
import type { BillStatus } from "./bills/model";
import {
  BILL_SOURCE_TYPES,
  BILL_STATUSES,
  buildOrderListUrlSearchParams,
  parseOrderListUrlState,
  toBillListQuery,
  type BillSourceType,
  type OrderListUrlState,
  type OrderListView,
} from "./list-query-url";
import type {
  OrderListQuery,
  PaymentOrderPosSyncStatus,
  PaymentOrderSort,
  PaymentOrderStatus,
} from "./model";
import { defaultOrderDateRange, resolveOrderDateRange } from "./order-date-range";
import { paymentMethodLabel } from "./payment-method";
import { useAcknowledgeOrderMutation, useOrdersPageQuery } from "./queries";

const SEARCH_DEBOUNCE_MS = 300;

// Translation keys in the `orders` namespace, not rendered text.
const VIEW_LABEL_KEY: Record<OrderListView, string> = {
  menu: "viewMenu",
  bill: "viewBill",
};
const VIEWS: OrderListView[] = ["menu", "bill"];

const BILL_STATUS_LABEL_KEY: Record<BillStatus, string> = {
  OPEN: "billFilterStatusOpen",
  PAID: "billFilterStatusPaid",
  CANCELLED: "billFilterStatusCancelled",
};

// Translation keys in the `orders` namespace, not rendered text.
const STATUS_LABEL_KEY: Record<PaymentOrderStatus, string> = {
  READY: "statusReady",
  ACKNOWLEDGED: "statusAcknowledged",
  DONE: "statusDone",
  CANCELLED: "statusCancelled",
};

const POS_SYNC_LABEL_KEY: Record<PaymentOrderPosSyncStatus, string> = {
  PENDING: "posSyncPending",
  SUCCEEDED: "posSyncSucceeded",
  FAILED: "posSyncFailed",
  NOT_CONFIGURED: "posSyncNotConfigured",
};

// READY hasn't been handled yet and needs attention; DONE is the settled,
// successful outcome; CANCELLED is inert. FAILED POS syncs get the most
// attention since they are a real operational error the operator must act
// on, unlike PENDING/NOT_CONFIGURED which are expected states.
const STATUS_COLOR_CLASS: Record<PaymentOrderStatus, string> = {
  READY: "text-warning",
  ACKNOWLEDGED: "text-foreground",
  DONE: "text-success",
  CANCELLED: "text-muted-foreground",
};

const POS_SYNC_COLOR_CLASS: Record<PaymentOrderPosSyncStatus, string> = {
  PENDING: "text-muted-foreground",
  SUCCEEDED: "text-success",
  FAILED: "text-destructive",
  NOT_CONFIGURED: "text-muted-foreground",
};

export function OrderListPage() {
  const { t, i18n } = useTranslation("orders");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlState = useMemo(() => parseOrderListUrlState(searchParams), [searchParams]);
  const { query } = urlState;
  const isBillView = urlState.view === "bill";

  const navigate = useCallback(
    (next: OrderListUrlState) => {
      const params = buildOrderListUrlSearchParams(next);
      const queryString = params.toString();
      // `scroll: false` — App Router scrolls to the top of the page on every
      // navigation by default, and a page/filter change here is a navigation.
      // The operator is already looking at the list they just clicked in;
      // yanking them to the top of the document is the jump this screen was
      // reported for.
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const updateQuery = useCallback(
    (patch: Partial<OrderListQuery>) => navigate({ ...urlState, query: { ...query, ...patch } }),
    [navigate, urlState, query],
  );

  // Switching views, or a bill-only filter, starts over from page 1 like
  // every other filter change on this screen.
  const updateView = (patch: Partial<Omit<OrderListUrlState, "query">>) =>
    navigate({ ...urlState, ...patch, query: { ...query, page: 1 } });

  // Local, immediately-updated search box synced to the URL only after
  // debouncing — same pattern as `RequestListPage`/`SpecialRequestPage`'s
  // search input.
  const [searchInput, setSearchInput] = useState(query.search);
  const [syncedSearch, setSyncedSearch] = useState(query.search);
  if (query.search !== syncedSearch) {
    setSyncedSearch(query.search);
    setSearchInput(query.search);
  }

  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (debouncedSearch !== query.search) {
      updateQuery({ search: debouncedSearch, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // The URL starts with no date bound (see `list-query-url.ts` — there is
  // no fixed default to omit-and-imply, since "last 7 days" shifts with
  // the clock). This effect applies the real default client-side only,
  // after mount — same hydration-safety reasoning as `SalesStatsPage`'s
  // mount effect, since a `new Date()` read during render could disagree
  // between the server's render and the client's. It depends on
  // `dateFrom`/`dateTo` rather than running once, because App Router
  // re-renders this component in place (it is not remounted) when the
  // sidebar's link to this same route is clicked again: that navigation
  // clears the query string, and a mount-only effect would never re-fill
  // it, leaving the screen stuck on the "resolving the default range"
  // state below. The `if` guard still keeps this idempotent once a range
  // is present.
  useEffect(() => {
    if (!query.dateFrom || !query.dateTo) {
      const defaults = defaultOrderDateRange();
      updateQuery({ dateFrom: defaults.from, dateTo: defaults.to, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.dateFrom, query.dateTo]);

  const dateRangeResult = resolveOrderDateRange(query.dateFrom, query.dateTo);
  // Wrapped so a failed page/filter/sort/date change keeps the rows the
  // operator was already reading — `keepPreviousData` alone drops them the
  // moment the new key's request fails. See `useRetainedListQuery`.
  // The menu-row list is only fetched while it is the view on screen; the
  // bill view fetches its own list (see `BillListView`).
  const ordersQuery = useRetainedListQuery(
    useOrdersPageQuery(query, dateRangeResult.ok && !isBillView),
    query,
  );
  const acknowledgeMutation = useAcknowledgeOrderMutation();

  if (!query.dateFrom || !query.dateTo || (!isBillView && ordersQuery.isLoading)) {
    return <ListSkeletonState columns={8} label={t("loading")} />;
  }

  if (!dateRangeResult.ok) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("statsInvalidRange")}
      </p>
    );
  }

  // A failure with rows already on screen — a page click, a filter change, a
  // background refetch — must not tear the table down. Only a failure with
  // nothing preserved behind it, i.e. a first load, replaces the whole
  // screen.
  if (!isBillView && ordersQuery.isError && !ordersQuery.data) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={ordersQuery.error instanceof Error ? ordersQuery.error.message : undefined}
        onRetry={() => ordersQuery.refetch()}
      />
    );
  }

  const orders = ordersQuery.data?.items ?? [];
  const hasActiveFilter =
    Boolean(query.status) || Boolean(query.posSyncStatus) || query.search.trim().length > 0;

  const STATUS_FILTER_LABELS: Record<string, string> = {
    all: t("common:filterAll"),
    READY: t("statusReady"),
    ACKNOWLEDGED: t("statusAcknowledged"),
    DONE: t("statusDone"),
    CANCELLED: t("statusCancelled"),
  };
  const POS_SYNC_FILTER_LABELS: Record<string, string> = {
    all: t("common:filterAll"),
    PENDING: t("posSyncPending"),
    SUCCEEDED: t("posSyncSucceeded"),
    FAILED: t("posSyncFailed"),
    NOT_CONFIGURED: t("posSyncNotConfigured"),
  };
  const SORT_LABELS: Record<string, string> = {
    createdAt: t("sortByCreatedAt"),
    amount: t("sortByAmount"),
  };
  const BILL_STATUS_FILTER_LABELS: Record<string, string> = {
    all: t("common:filterAll"),
    OPEN: t("billFilterStatusOpen"),
    PAID: t("billFilterStatusPaid"),
    CANCELLED: t("billFilterStatusCancelled"),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
      </div>

      <div
        role="group"
        aria-label={t("viewToggleLabel")}
        className="inline-flex w-fit gap-1 rounded-lg border border-border bg-muted p-1"
      >
        {VIEWS.map((view) => {
          const isActive = urlState.view === view;
          return (
            <Button
              key={view}
              type="button"
              size="sm"
              variant={isActive ? "default" : "ghost"}
              aria-pressed={isActive}
              onClick={() => {
                if (!isActive) updateView({ view });
              }}
            >
              {t(VIEW_LABEL_KEY[view])}
            </Button>
          );
        })}
      </div>

      <ListToolbar
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder={t("searchPlaceholder")}
        className="items-end"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="order-date-from">{t("statsFromLabel")}</Label>
          <Input
            id="order-date-from"
            type="date"
            value={query.dateFrom}
            onChange={(event) => updateQuery({ dateFrom: event.target.value, page: 1 })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="order-date-to">{t("statsToLabel")}</Label>
          <Input
            id="order-date-to"
            type="date"
            value={query.dateTo}
            onChange={(event) => updateQuery({ dateTo: event.target.value, page: 1 })}
          />
        </div>

        {isBillView ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="order-bill-status-filter">{t("billFilterStatusLabel")}</Label>
              <Select
                value={urlState.billStatus ?? "all"}
                onValueChange={(value) =>
                  updateView({ billStatus: value === "all" ? undefined : (value as BillStatus) })
                }
              >
                <SelectTrigger
                  id="order-bill-status-filter"
                  size="sm"
                  className="w-32"
                  aria-label={t("billFilterStatusLabel")}
                >
                  <SelectValue placeholder={t("billFilterStatusLabel")}>
                    {(value: string) => BILL_STATUS_FILTER_LABELS[value] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common:filterAll")}</SelectItem>
                  {BILL_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(BILL_STATUS_LABEL_KEY[status])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="order-bill-source-filter">{t("billFilterSourceLabel")}</Label>
              <Select
                value={urlState.billSource ?? "all"}
                onValueChange={(value) =>
                  updateView({ billSource: value === "all" ? undefined : (value as BillSourceType) })
                }
              >
                <SelectTrigger
                  id="order-bill-source-filter"
                  size="sm"
                  className="w-32"
                  aria-label={t("billFilterSourceLabel")}
                >
                  <SelectValue placeholder={t("billFilterSourceLabel")}>
                    {(value: string) => (value === "all" ? t("common:filterAll") : paymentMethodLabel(value, t))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common:filterAll")}</SelectItem>
                  {BILL_SOURCE_TYPES.map((source) => (
                    <SelectItem key={source} value={source}>
                      {paymentMethodLabel(source, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="order-status-filter">{t("statusFilterLabel")}</Label>
              <Select
                value={query.status ?? "all"}
                onValueChange={(value) =>
                  updateQuery({
                    status: value === "all" ? undefined : (value as PaymentOrderStatus),
                    page: 1,
                  })
                }
              >
                <SelectTrigger id="order-status-filter" size="sm" className="w-32" aria-label={t("statusFilterLabel")}>
                  <SelectValue placeholder={t("statusFilterLabel")}>
                    {(value: string) => STATUS_FILTER_LABELS[value] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common:filterAll")}</SelectItem>
                  <SelectItem value="READY">{t("statusReady")}</SelectItem>
                  <SelectItem value="ACKNOWLEDGED">{t("statusAcknowledged")}</SelectItem>
                  <SelectItem value="DONE">{t("statusDone")}</SelectItem>
                  <SelectItem value="CANCELLED">{t("statusCancelled")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="order-pos-sync-filter">{t("posSyncFilterLabel")}</Label>
              <Select
                value={query.posSyncStatus ?? "all"}
                onValueChange={(value) =>
                  updateQuery({
                    posSyncStatus: value === "all" ? undefined : (value as PaymentOrderPosSyncStatus),
                    page: 1,
                  })
                }
              >
                <SelectTrigger
                  id="order-pos-sync-filter"
                  size="sm"
                  className="w-32"
                  aria-label={t("posSyncFilterLabel")}
                >
                  <SelectValue placeholder={t("posSyncFilterLabel")}>
                    {(value: string) => POS_SYNC_FILTER_LABELS[value] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common:filterAll")}</SelectItem>
                  <SelectItem value="PENDING">{t("posSyncPending")}</SelectItem>
                  <SelectItem value="SUCCEEDED">{t("posSyncSucceeded")}</SelectItem>
                  <SelectItem value="FAILED">{t("posSyncFailed")}</SelectItem>
                  <SelectItem value="NOT_CONFIGURED">{t("posSyncNotConfigured")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="order-sort">{t("common:sortLabel")}</Label>
              <Select
                value={query.sort}
                onValueChange={(value) => updateQuery({ sort: value as PaymentOrderSort, page: 1 })}
              >
                <SelectTrigger id="order-sort" size="sm" className="w-32" aria-label={t("common:sortLabel")}>
                  <SelectValue placeholder={t("common:sortLabel")}>
                    {(value: string) => SORT_LABELS[value] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt">{t("sortByCreatedAt")}</SelectItem>
                  <SelectItem value="amount">{t("sortByAmount")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </ListToolbar>

      {isBillView ? (
        <BillListView
          query={toBillListQuery(urlState)}
          enabled={dateRangeResult.ok}
          onPageChange={(page) => updateQuery({ page })}
          onPageSizeChange={(pageSize) => updateQuery({ pageSize, page: 1 })}
        />
      ) : (
        <>
          {ordersQuery.isError ? (
            <ErrorState
              // When rows survived the failure they are the previously loaded
              // page, not the one the URL now names — the title has to say so,
              // or the screen silently misreports what it is showing.
              title={ordersQuery.isRetained ? t("common:listRetainedErrorTitle") : t("errorTitle")}
              message={ordersQuery.error instanceof Error ? ordersQuery.error.message : undefined}
              onRetry={() => ordersQuery.refetch()}
            />
          ) : null}

          {/* Total, pagination, and rows are all read off the same result, so a
              retained page reports its own total and position rather than the
              ones the failed request asked for. */}
          <ListTotalCount count={ordersQuery.total} />

          {/* The rows stay put through a page change (see `useOrdersPageQuery`'s
              `placeholderData`) and through a failed one (see
              `useRetainedListQuery`) — the bar reports the fetch, and `stale`
              says the page on screen is still the previous one. */}
          <ListUpdatingRegion
            active={ordersQuery.isFetching}
            stale={ordersQuery.isStale}
          >
            {orders.length === 0 ? (
              hasActiveFilter ? (
                <EmptyState
                  title={t("common:listNoResultsTitle")}
                  description={t("common:listNoResultsDescription")}
                />
              ) : (
                <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
              )
            ) : (
              <Table className="min-w-[60rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">{t("columnOrderedAt")}</TableHead>
                    <TableHead className="w-20">{t("common:columnTable")}</TableHead>
                    <TableHead className="w-[18%]">{t("columnMenuItem")}</TableHead>
                    <TableHead>{t("columnRequestNote")}</TableHead>
                    <TableHead className="w-24">{t("columnAmount")}</TableHead>
                    <TableHead className="w-24">{t("columnStatus")}</TableHead>
                    <TableHead className="w-32">{t("columnPosSync")}</TableHead>
                    <TableHead className="w-28">{t("common:columnActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.orderId}>
                      <TableCell>
                        {/* The order time, not the payment time: a POS order carries
                            TossPlace's openedAt here, and an unpaid order still has
                            a time to show. The payment time lives on the detail. */}
                        {formatDateTime(order.createdAt, i18n.language)}
                      </TableCell>
                      <TableCell>{order.tableNumber || "-"}</TableCell>
                      <TableCell title={`${order.menuItemName} (${order.categoryName})`}>
                        <Link
                          href={`/orders/${order.orderId}`}
                          className="text-foreground underline underline-offset-4 hover:font-bold"
                        >
                          {order.menuItemName}
                        </Link>
                        <span className="text-muted-foreground"> ({order.categoryName})</span>
                      </TableCell>
                      <TableCell>{order.requestNote || "-"}</TableCell>
                      <TableCell>{formatCurrencyKRW(order.amount, i18n.language)}</TableCell>
                      <TableCell className={STATUS_COLOR_CLASS[order.status]}>
                        {t(STATUS_LABEL_KEY[order.status])}
                      </TableCell>
                      <TableCell className={POS_SYNC_COLOR_CLASS[order.posSyncStatus]}>
                        {t(POS_SYNC_LABEL_KEY[order.posSyncStatus])}
                      </TableCell>
                      <TableCell>
                        {order.status === "READY" ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              acknowledgeMutation.isPending &&
                              acknowledgeMutation.variables === order.orderId
                            }
                            onClick={() => acknowledgeMutation.mutate(order.orderId)}
                          >
                            {t("detailAcknowledgeButton")}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ListUpdatingRegion>

          <Pagination
            page={ordersQuery.page}
            pageSize={ordersQuery.pageSize}
            total={ordersQuery.total}
            onPageChange={(page) => updateQuery({ page })}
            onPageSizeChange={(pageSize) => updateQuery({ pageSize, page: 1 })}
          />
        </>
      )}
    </div>
  );
}
