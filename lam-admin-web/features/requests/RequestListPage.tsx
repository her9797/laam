"use client";

import "@/i18n/client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { stripSongRequestPrefix } from "@/features/dashboard/summary";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useRetainedListQuery } from "@/hooks/use-retained-list-query";
import { defaultDateRangeDays, resolveCalendarDateRange } from "@/lib/date-range";
import { formatDateTime } from "@/lib/utils";

import { buildRequestListSearchParams, parseRequestListQuery } from "./list-query-url";
import type { CustomerRequest, CustomerRequestListQuery, CustomerRequestSort, CustomerRequestStatus } from "./model";
import {
  useApproveSongRequestMutation,
  useCustomerRequestsPageQuery,
  useUpdateCustomerRequestStatusMutation,
} from "./queries";

// Translation keys in the `requests` namespace, not rendered text.
const STATUS_LABEL_KEY: Record<CustomerRequestStatus, string> = {
  pending: "statusPending",
  checked: "statusChecked",
  completed: "statusCompleted",
};

// Which status a "next action" button on a row moves it to, and the label
// key for that button — mirrors `admin-screen.tsx`'s `handleCustomerRequestStatusChange`
// two-step flow (pending -> checked -> completed). A completed request has
// no next action.
const NEXT_STATUS: Partial<
  Record<CustomerRequestStatus, { status: CustomerRequestStatus; labelKey: string }>
> = {
  pending: { status: "checked", labelKey: "actionCheck" },
  checked: { status: "completed", labelKey: "actionComplete" },
};

export type RequestListPageKind = "general" | "song";

const COPY_KEYS: Record<
  RequestListPageKind,
  { title: string; loadingLabel: string; emptyTitle: string; emptyDescription: string }
> = {
  general: {
    title: "generalTitle",
    loadingLabel: "generalLoading",
    emptyTitle: "generalEmptyTitle",
    emptyDescription: "generalEmptyDescription",
  },
  song: {
    title: "songTitle",
    loadingLabel: "songLoading",
    emptyTitle: "songEmptyTitle",
    emptyDescription: "songEmptyDescription",
  },
};

const SEARCH_DEBOUNCE_MS = 300;

// Default date-filter span for this screen, per this feature's plan —
// unlike the sales-stats screen (30 days), request lists default to the
// last 7 days.
const DEFAULT_DATE_RANGE_SPAN_DAYS = 7;

export function RequestListPage({ kind }: { kind: RequestListPageKind }) {
  const { t, i18n } = useTranslation("requests");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => parseRequestListQuery(searchParams, kind), [searchParams, kind]);

  const updateQuery = useCallback(
    (patch: Partial<CustomerRequestListQuery>) => {
      const params = buildRequestListSearchParams({ ...query, ...patch });
      const queryString = params.toString();
      // `scroll: false` — see `features/orders/OrderListPage.tsx`: App Router
      // scrolls to the top of the document on every navigation, and a
      // page/filter change here is a navigation.
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [query, pathname, router],
  );

  // The search box is a local, immediately-updated value so typing feels
  // responsive; only the debounced value is pushed into the URL (and so,
  // in turn, the fetch). Re-synced from the URL during render (React's
  // "adjusting state when a prop changes" pattern, not an effect — an
  // effect here would commit a stale box value for one extra render) so
  // switching between /requests and /song-requests, or using the back
  // button, doesn't leave stale text in the box.
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
    // Only the debounced value should re-trigger this; `query`/`updateQuery`
    // change on every URL update this effect itself causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // The URL starts with no date bound (see `list-query-url.ts` — there is
  // no fixed default to omit-and-imply, since "last 7 days" shifts with
  // the clock). This effect applies the real default exactly once,
  // client-side only, after mount — same hydration-safety reasoning as
  // `SalesStatsPage`'s mount effect.
  useEffect(() => {
    if (!query.dateFrom || !query.dateTo) {
      const defaults = defaultDateRangeDays(DEFAULT_DATE_RANGE_SPAN_DAYS);
      updateQuery({ dateFrom: defaults.from, dateTo: defaults.to, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateRangeResult = resolveCalendarDateRange(query.dateFrom, query.dateTo);
  // Wrapped so a failed page/filter/sort/date change keeps the rows the
  // operator was already reading — `keepPreviousData` alone drops them the
  // moment the new key's request fails. See `useRetainedListQuery`.
  const requestsQuery = useRetainedListQuery(
    useCustomerRequestsPageQuery(query, dateRangeResult.ok),
    query,
  );
  const statusMutation = useUpdateCustomerRequestStatusMutation();
  const approveMutation = useApproveSongRequestMutation();
  const copyKeys = COPY_KEYS[kind];

  if (!query.dateFrom || !query.dateTo || requestsQuery.isLoading) {
    return <ListSkeletonState columns={5} label={t(copyKeys.loadingLabel)} />;
  }

  if (!dateRangeResult.ok) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("dateInvalidRange")}
      </p>
    );
  }

  // A failure with rows already on screen — a page click, a filter change, a
  // background refetch — must not tear the table down. Only a failure with
  // nothing preserved behind it, i.e. a first load, replaces the whole
  // screen.
  if (requestsQuery.isError && !requestsQuery.data) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={requestsQuery.error instanceof Error ? requestsQuery.error.message : undefined}
        onRetry={() => requestsQuery.refetch()}
      />
    );
  }

  const requests = requestsQuery.data?.items ?? [];
  const hasActiveFilter = Boolean(query.status) || query.search.trim().length > 0;

  // Label lookups for the two <Select>s below — see the render-prop comment
  // at their `SelectValue` for why these exist.
  const STATUS_FILTER_LABELS: Record<string, string> = {
    all: t("common:filterAll"),
    pending: t("statusPending"),
    checked: t("statusChecked"),
    completed: t("statusCompleted"),
  };
  const SORT_LABELS: Record<string, string> = {
    status: t("sortByStatus"),
    createdAt: t("sortByCreatedAt"),
    tableNumber: t("sortByTableNumber"),
  };

  function isRowMutating(id: string): boolean {
    return (
      (statusMutation.isPending && statusMutation.variables?.id === id) ||
      (approveMutation.isPending && approveMutation.variables?.requestId === id)
    );
  }

  function handleAdvance(request: CustomerRequest) {
    if (kind === "song" && request.status === "pending") {
      approveMutation.mutate({ requestId: request.id });
      return;
    }
    const next = NEXT_STATUS[request.status];
    if (!next) {
      return;
    }
    statusMutation.mutate({ id: request.id, status: next.status });
  }

  function mutationErrorMessage(): string {
    const approvalError = approveMutation.error;
    if (approvalError && typeof approvalError === "object" && "status" in approvalError) {
      if (approvalError.status === 503) return t("songApprovalNotConfigured");
      if (approvalError.status === 404) return t("songApprovalNoResults");
    }
    if (approvalError instanceof Error) return approvalError.message;
    if (statusMutation.error instanceof Error) return statusMutation.error.message;
    return t("statusChangeFailed");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">{t(copyKeys.title)}</h1>
      </div>

      <ListToolbar
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder={t("searchPlaceholder")}
        className="items-end"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="request-date-from">{t("dateFromLabel")}</Label>
          <Input
            id="request-date-from"
            type="date"
            value={query.dateFrom}
            onChange={(event) => updateQuery({ dateFrom: event.target.value, page: 1 })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="request-date-to">{t("dateToLabel")}</Label>
          <Input
            id="request-date-to"
            type="date"
            value={query.dateTo}
            onChange={(event) => updateQuery({ dateTo: event.target.value, page: 1 })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="request-status-filter">{t("statusFilterLabel")}</Label>
          <Select
            value={query.status ?? "all"}
            onValueChange={(value) =>
              updateQuery({
                status: value === "all" ? undefined : (value as CustomerRequestStatus),
                page: 1,
              })
            }
          >
            <SelectTrigger
              id="request-status-filter"
              size="sm"
              className="w-32"
              aria-label={t("statusFilterLabel")}
            >
              {/* Base UI's <Select.Value> shows the raw string value unless
                  told how to render a label for it — see its own doc comment
                  ("When the item values are objects ... {value, label}").
                  Since these items are plain strings, this render-prop is
                  required or the trigger displays "all"/"pending" literally. */}
              <SelectValue placeholder={t("statusFilterLabel")}>
                {(value: string) => STATUS_FILTER_LABELS[value] ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common:filterAll")}</SelectItem>
              <SelectItem value="pending">{t("statusPending")}</SelectItem>
              <SelectItem value="checked">{t("statusChecked")}</SelectItem>
              <SelectItem value="completed">{t("statusCompleted")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="request-sort">{t("common:sortLabel")}</Label>
          <Select
            value={query.sort}
            onValueChange={(value) => updateQuery({ sort: value as CustomerRequestSort, page: 1 })}
          >
            <SelectTrigger id="request-sort" size="sm" className="w-32" aria-label={t("common:sortLabel")}>
              <SelectValue placeholder={t("common:sortLabel")}>
                {(value: string) => SORT_LABELS[value] ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="status">{t("sortByStatus")}</SelectItem>
              <SelectItem value="createdAt">{t("sortByCreatedAt")}</SelectItem>
              <SelectItem value="tableNumber">{t("sortByTableNumber")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </ListToolbar>

      {requestsQuery.isError ? (
        <ErrorState
          // When rows survived the failure they are the previously loaded
          // page, not the one the URL now names — the title has to say so,
          // or the screen silently misreports what it is showing.
          title={requestsQuery.isRetained ? t("common:listRetainedErrorTitle") : t("errorTitle")}
          message={requestsQuery.error instanceof Error ? requestsQuery.error.message : undefined}
          onRetry={() => requestsQuery.refetch()}
        />
      ) : null}

      {statusMutation.isError || approveMutation.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {mutationErrorMessage()}
        </p>
      ) : null}

      {/* Total, pagination, and rows are all read off the same result, so a
          retained page reports its own total and position rather than the
          ones the failed request asked for. */}
      <ListTotalCount count={requestsQuery.total} />

      {/* The rows stay put through a page change (see
          `useCustomerRequestsPageQuery`'s `placeholderData`) and through a
          failed one (see `useRetainedListQuery`) — the bar reports the fetch,
          and `stale` says the page on screen is still the previous one. */}
      <ListUpdatingRegion
        active={requestsQuery.isFetching}
        stale={requestsQuery.isStale}
      >
        {requests.length === 0 ? (
          hasActiveFilter ? (
            <EmptyState
              title={t("common:listNoResultsTitle")}
              description={t("common:listNoResultsDescription")}
            />
          ) : (
            <EmptyState title={t(copyKeys.emptyTitle)} description={t(copyKeys.emptyDescription)} />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t("common:columnCreatedAt")}</TableHead>
                <TableHead className="w-20">{t("common:columnTable")}</TableHead>
                <TableHead>{t("columnText")}</TableHead>
                <TableHead className="w-24">{t("columnStatus")}</TableHead>
                <TableHead className="w-28">{t("common:columnActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => {
                const next =
                  kind === "song"
                    ? request.status === "pending"
                      ? { status: "checked" as const, labelKey: "actionApproveAndPlay" }
                      : undefined
                    : NEXT_STATUS[request.status];
                const statusLabel =
                  kind === "song" && request.status === "checked"
                    ? t("songStatusQueued")
                    : kind === "song" && request.status === "completed"
                      ? t("songStatusCompleted")
                      : t(STATUS_LABEL_KEY[request.status]);
                return (
                  <TableRow key={request.id}>
                    <TableCell>{formatDateTime(request.createdAt, i18n.language)}</TableCell>
                    <TableCell>{request.tableNumber || "-"}</TableCell>
                    <TableCell className="whitespace-normal">
                      {kind === "song" ? stripSongRequestPrefix(request.text) : request.text}
                    </TableCell>
                    <TableCell>{statusLabel}</TableCell>
                    <TableCell>
                      {next ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isRowMutating(request.id)}
                          onClick={() => handleAdvance(request)}
                        >
                          {t(next.labelKey)}
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ListUpdatingRegion>

      <Pagination
        page={requestsQuery.page}
        pageSize={requestsQuery.pageSize}
        total={requestsQuery.total}
        onPageChange={(page) => updateQuery({ page })}
        onPageSizeChange={(pageSize) => updateQuery({ pageSize, page: 1 })}
      />
    </div>
  );
}
