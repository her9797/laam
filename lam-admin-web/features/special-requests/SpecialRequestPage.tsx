"use client";

import "@/i18n/client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ListToolbar } from "@/components/list/ListToolbar";
import { ListTotalCount } from "@/components/list/ListTotalCount";
import { ListUpdatingRegion } from "@/components/list/ListUpdatingRegion";
import { Pagination } from "@/components/list/Pagination";
import { EmptyState, ErrorState, ListSkeletonState } from "@/components/states/PageStates";
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
import { defaultDateRangeDays, resolveCalendarDateRange } from "@/lib/date-range";
import { formatDateTime } from "@/lib/utils";

import type { SpecialRequest, SpecialRequestGender, SpecialRequestListQuery, SpecialRequestSort } from "./model";
import { useDeleteSpecialRequestMutation, useSpecialRequestsPageQuery } from "./queries";

// Field list mirrors `admin-screen.tsx`'s special-request detail modal
// exactly (table / name / age / residence / contact / ideal type / message)
// so the operator sees the same fields they already know from the current
// app. Labels are keys in the `specialRequests` namespace.
const DETAIL_FIELDS: Array<{ key: keyof SpecialRequest; labelKey: string }> = [
  { key: "tableNumber", labelKey: "fieldTableNumber" },
  { key: "name", labelKey: "fieldName" },
  { key: "age", labelKey: "fieldAge" },
  { key: "residence", labelKey: "fieldResidence" },
  { key: "instagram", labelKey: "fieldInstagram" },
  { key: "idealType", labelKey: "fieldIdealType" },
  { key: "text", labelKey: "fieldText" },
];

const SEARCH_DEBOUNCE_MS = 300;

// Default date-filter span for this screen, per this feature's plan —
// unlike the sales-stats screen (30 days), request lists default to the
// last 7 days.
const DEFAULT_DATE_RANGE_SPAN_DAYS = 7;

// `dateFrom`/`dateTo` start blank — deterministic on both the server's
// render and the client's first render — and are filled in by the mount
// effect below, exactly once, client-side only. See `SalesStatsPage`'s
// identical mount-effect comment for why: a `new Date()` read during
// render here could disagree between the server and client passes.
const DEFAULT_QUERY: SpecialRequestListQuery = {
  page: 1,
  pageSize: 10,
  gender: undefined,
  search: "",
  dateFrom: "",
  dateTo: "",
  sort: "createdAt",
  order: "desc",
};

export function SpecialRequestPage() {
  const { t, i18n } = useTranslation("specialRequests");

  // Unlike the general/song request screens, this state is deliberately
  // never synced to the URL: `search` can hold a guest's name or contact
  // info, and this screen already keeps that data out of the address bar
  // and browser history for the detail/delete dialogs below (both driven by
  // in-memory ids only) — see `docs/plans/2026-09-04-admin-list-paging-search-sort.md`
  // section 4.5.
  const [query, setQuery] = useState<SpecialRequestListQuery>(DEFAULT_QUERY);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  // React's "adjusting state when a prop changes" pattern (setState during
  // render, guarded), not an effect — see `RequestListPage`'s identical
  // comment for why an effect here would trip `react-hooks/set-state-in-effect`.
  const [syncedSearch, setSyncedSearch] = useState(debouncedSearch);
  if (debouncedSearch !== syncedSearch) {
    setSyncedSearch(debouncedSearch);
    setQuery((prev) => ({ ...prev, search: debouncedSearch, page: 1 }));
  }

  useEffect(() => {
    if (!query.dateFrom || !query.dateTo) {
      const defaults = defaultDateRangeDays(DEFAULT_DATE_RANGE_SPAN_DAYS);
      // Same deliberate exception `SalesStatsPage`'s mount effect documents:
      // there is no render-time computation of "today" that both the
      // server and the client can agree on, so applying it after mount
      // (accepting the one extra render pass) is the fix, not the problem.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery((prev) => ({ ...prev, dateFrom: defaults.from, dateTo: defaults.to, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateRangeResult = resolveCalendarDateRange(query.dateFrom, query.dateTo);
  // Wrapped so a failed page/filter/sort/date change keeps the rows the
  // operator was already reading — `keepPreviousData` alone drops them the
  // moment the new key's request fails. See `useRetainedListQuery`.
  const requestsQuery = useRetainedListQuery(
    useSpecialRequestsPageQuery(query, dateRangeResult.ok),
    query,
  );
  const deleteMutation = useDeleteSpecialRequestMutation();
  // Both dialogs are driven by in-memory ids only (never a URL/query param),
  // so a guest's personal fields never end up in the address bar or browser
  // history.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  if (!query.dateFrom || !query.dateTo || requestsQuery.isLoading) {
    return <ListSkeletonState columns={4} label={t("loading")} />;
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
  const hasActiveFilter = Boolean(query.gender) || query.search.trim().length > 0;
  const detailRequest = requests.find((request) => request.id === detailId) ?? null;
  const deleteTarget = requests.find((request) => request.id === pendingDeleteId) ?? null;

  function isRowDeleting(id: string): boolean {
    return deleteMutation.isPending && deleteMutation.variables === id;
  }

  function handleConfirmDelete() {
    if (!pendingDeleteId) {
      return;
    }
    const targetId = pendingDeleteId;
    deleteMutation.mutate(targetId, {
      onSuccess: () => {
        setPendingDeleteId(null);
        if (detailId === targetId) {
          setDetailId(null);
        }
      },
    });
  }

  // Label lookups for the two <Select>s below — Base UI's <Select.Value>
  // shows the raw string value unless told how to render a label for it
  // (its own doc comment: "When the item values are objects ... {value,
  // label}"). These items are plain strings, so the render-prop is required.
  const GENDER_FILTER_LABELS: Record<string, string> = {
    all: t("common:filterAll"),
    male: t("genderMale"),
    female: t("genderFemale"),
  };
  const SORT_LABELS: Record<string, string> = {
    createdAt: t("sortByCreatedAt"),
    name: t("sortByName"),
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
          <Label htmlFor="special-request-date-from">{t("dateFromLabel")}</Label>
          <Input
            id="special-request-date-from"
            type="date"
            value={query.dateFrom}
            onChange={(event) =>
              setQuery((prev) => ({ ...prev, dateFrom: event.target.value, page: 1 }))
            }
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="special-request-date-to">{t("dateToLabel")}</Label>
          <Input
            id="special-request-date-to"
            type="date"
            value={query.dateTo}
            onChange={(event) => setQuery((prev) => ({ ...prev, dateTo: event.target.value, page: 1 }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="special-request-gender-filter">{t("genderFilterLabel")}</Label>
          <Select
            value={query.gender ?? "all"}
            onValueChange={(value) =>
              setQuery((prev) => ({
                ...prev,
                gender: value === "all" ? undefined : (value as SpecialRequestGender),
                page: 1,
              }))
            }
          >
            <SelectTrigger
              id="special-request-gender-filter"
              size="sm"
              className="w-32"
              aria-label={t("genderFilterLabel")}
            >
              <SelectValue placeholder={t("genderFilterLabel")}>
                {(value: string) => GENDER_FILTER_LABELS[value] ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common:filterAll")}</SelectItem>
              <SelectItem value="male">{t("genderMale")}</SelectItem>
              <SelectItem value="female">{t("genderFemale")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="special-request-sort">{t("common:sortLabel")}</Label>
          <Select
            value={query.sort}
            onValueChange={(value) =>
              setQuery((prev) => ({ ...prev, sort: value as SpecialRequestSort, page: 1 }))
            }
          >
            <SelectTrigger id="special-request-sort" size="sm" className="w-32" aria-label={t("common:sortLabel")}>
              <SelectValue placeholder={t("common:sortLabel")}>
                {(value: string) => SORT_LABELS[value] ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">{t("sortByCreatedAt")}</SelectItem>
              <SelectItem value="name">{t("sortByName")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </ListToolbar>

      {requestsQuery.isError ? (
        <ErrorState
          // When rows survived the failure they are the previously loaded
          // page, not the one the screen now asks for — the title has to say
          // so, or the screen silently misreports what it is showing.
          title={requestsQuery.isRetained ? t("common:listRetainedErrorTitle") : t("errorTitle")}
          message={requestsQuery.error instanceof Error ? requestsQuery.error.message : undefined}
          onRetry={() => requestsQuery.refetch()}
        />
      ) : null}

      {deleteMutation.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {deleteMutation.error instanceof Error
            ? deleteMutation.error.message
            : t("deleteFailed")}
        </p>
      ) : null}

      {/* Total, pagination, and rows are all read off the same result, so a
          retained page reports its own total and position rather than the
          ones the failed request asked for. */}
      <ListTotalCount count={requestsQuery.total} />

      {/* The rows stay put through a page change (see
          `useSpecialRequestsPageQuery`'s `placeholderData`) and through a
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
            <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t("common:columnCreatedAt")}</TableHead>
                <TableHead className="w-20">{t("common:columnTable")}</TableHead>
                <TableHead>{t("common:columnName")}</TableHead>
                <TableHead className="w-44">{t("common:columnActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>{formatDateTime(request.createdAt, i18n.language)}</TableCell>
                  <TableCell>{request.tableNumber || "-"}</TableCell>
                  <TableCell>{request.name}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setDetailId(request.id)}
                      >
                        {t("viewDetail")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={isRowDeleting(request.id)}
                        onClick={() => setPendingDeleteId(request.id)}
                      >
                        {t("common:delete")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListUpdatingRegion>

      <Pagination
        page={requestsQuery.page}
        pageSize={requestsQuery.pageSize}
        total={requestsQuery.total}
        onPageChange={(page) => setQuery((prev) => ({ ...prev, page }))}
        onPageSizeChange={(pageSize) => setQuery((prev) => ({ ...prev, pageSize, page: 1 }))}
      />

      <Dialog
        open={detailRequest !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("detailTitle")}</DialogTitle>
          </DialogHeader>
          {detailRequest ? (
            <dl className="flex flex-col gap-3">
              {DETAIL_FIELDS.map((field) => (
                <div key={field.key} className="flex flex-col gap-0.5">
                  <dt className="text-sm font-medium text-foreground">{t(field.labelKey)}</dt>
                  <dd className="text-sm text-muted-foreground">{detailRequest[field.key]}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? t("deleteTarget", { name: deleteTarget.name }) : ""}
              {t("common:deleteIrreversible")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={deleteMutation.isPending} onClick={handleConfirmDelete}>
              {t("common:delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
