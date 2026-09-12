"use client";

import "@/i18n/client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { ListToolbar } from "@/components/list/ListToolbar";
import { ListTotalCount } from "@/components/list/ListTotalCount";
import { Pagination } from "@/components/list/Pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
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
import { formatCurrencyKRW, formatDateTime } from "@/lib/utils";

import { buildOrderListSearchParams, parseOrderListQuery } from "./list-query-url";
import type {
  OrderListQuery,
  PaymentOrderPosSyncStatus,
  PaymentOrderSort,
  PaymentOrderStatus,
} from "./model";
import { defaultOrderDateRange, resolveOrderDateRange } from "./order-date-range";
import { useOrdersPageQuery } from "./queries";

const SEARCH_DEBOUNCE_MS = 300;

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

export function OrderListPage() {
  const { t, i18n } = useTranslation("orders");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => parseOrderListQuery(searchParams), [searchParams]);

  const updateQuery = useCallback(
    (patch: Partial<OrderListQuery>) => {
      const params = buildOrderListSearchParams({ ...query, ...patch });
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [query, pathname, router],
  );

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
  // the clock). This effect applies the real default exactly once,
  // client-side only, after mount — same hydration-safety reasoning as
  // `SalesStatsPage`'s mount effect, since a `new Date()` read during
  // render could disagree between the server's render and the client's.
  useEffect(() => {
    if (!query.dateFrom || !query.dateTo) {
      const defaults = defaultOrderDateRange();
      updateQuery({ dateFrom: defaults.from, dateTo: defaults.to, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateRangeResult = resolveOrderDateRange(query.dateFrom, query.dateTo);
  const ordersQuery = useOrdersPageQuery(query, dateRangeResult.ok);

  if (!query.dateFrom || !query.dateTo || ordersQuery.isLoading) {
    return <LoadingState label={t("loading")} />;
  }

  if (!dateRangeResult.ok) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("statsInvalidRange")}
      </p>
    );
  }

  if (ordersQuery.isError) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={ordersQuery.error instanceof Error ? ordersQuery.error.message : undefined}
        onRetry={() => ordersQuery.refetch()}
      />
    );
  }

  const orders = ordersQuery.data?.items ?? [];
  const total = ordersQuery.data?.total ?? 0;
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
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
      </ListToolbar>

      <ListTotalCount count={total} />

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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">{t("columnApprovedAt")}</TableHead>
              <TableHead className="w-20">{t("common:columnTable")}</TableHead>
              <TableHead>{t("columnMenuItem")}</TableHead>
              <TableHead className="w-28">{t("columnAmount")}</TableHead>
              <TableHead className="w-24">{t("columnStatus")}</TableHead>
              <TableHead className="w-32">{t("columnPosSync")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.orderId}>
                <TableCell>{formatDateTime(order.approvedAt ?? order.createdAt, i18n.language)}</TableCell>
                <TableCell>{order.tableNumber || "-"}</TableCell>
                <TableCell>
                  <Link
                    href={`/orders/${order.orderId}`}
                    className="text-foreground underline underline-offset-4 hover:font-bold"
                  >
                    {order.menuItemName}
                  </Link>
                  <span className="text-muted-foreground"> ({order.categoryName})</span>
                </TableCell>
                <TableCell>{formatCurrencyKRW(order.amount, i18n.language)}</TableCell>
                <TableCell>{t(STATUS_LABEL_KEY[order.status])}</TableCell>
                <TableCell>{t(POS_SYNC_LABEL_KEY[order.posSyncStatus])}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination
        page={query.page}
        pageSize={query.pageSize}
        total={total}
        onPageChange={(page) => updateQuery({ page })}
        onPageSizeChange={(pageSize) => updateQuery({ pageSize, page: 1 })}
      />
    </div>
  );
}
