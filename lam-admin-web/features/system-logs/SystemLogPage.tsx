"use client";

import "@/i18n/client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ListTotalCount } from "@/components/list/ListTotalCount";
import { ListUpdatingRegion } from "@/components/list/ListUpdatingRegion";
import { Pagination } from "@/components/list/Pagination";
import { EmptyState, ErrorState, ListSkeletonState } from "@/components/states/PageStates";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRetainedListQuery } from "@/hooks/use-retained-list-query";
import { formatDateTime } from "@/lib/utils";

import type { SystemLogListQuery } from "./model";
import { useSystemLogsPageQuery } from "./queries";

// Read-only diagnostics feed — no filters/search/sort/actions in this scope
// (unlike `RequestListPage`/`OrderListPage`), so the query only ever carries
// paging state.
const DEFAULT_QUERY: SystemLogListQuery = { page: 1, pageSize: 10 };

export function SystemLogPage() {
  const { t, i18n } = useTranslation("systemLogs");
  const [query, setQuery] = useState<SystemLogListQuery>(DEFAULT_QUERY);

  // Wrapped so a failed page change keeps the rows the operator was already
  // reading — `keepPreviousData` alone drops them the moment the new key's
  // request fails. See `useRetainedListQuery`.
  const logsQuery = useRetainedListQuery(useSystemLogsPageQuery(query), query);

  if (logsQuery.isLoading) {
    return <ListSkeletonState columns={4} label={t("loading")} />;
  }

  // A failure with rows already on screen — a page click or a background
  // refetch — must not tear the table down. Only a failure with nothing
  // preserved behind it, i.e. a first load, replaces the whole screen.
  if (logsQuery.isError && !logsQuery.data) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={logsQuery.error instanceof Error ? logsQuery.error.message : undefined}
        onRetry={() => logsQuery.refetch()}
      />
    );
  }

  const logs = logsQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
      </div>

      {logsQuery.isError ? (
        <ErrorState
          // When rows survived the failure they are the previously loaded
          // page, not the one just requested — the title has to say so, or
          // the screen silently misreports what it is showing.
          title={logsQuery.isRetained ? t("common:listRetainedErrorTitle") : t("errorTitle")}
          message={logsQuery.error instanceof Error ? logsQuery.error.message : undefined}
          onRetry={() => logsQuery.refetch()}
        />
      ) : null}

      {/* Total, pagination, and rows are all read off the same result, so a
          retained page reports its own total and position rather than the
          ones the failed request asked for. */}
      <ListTotalCount count={logsQuery.total} />

      {/* The rows stay put through a page change (see
          `useSystemLogsPageQuery`'s `placeholderData`) and through a failed
          one (see `useRetainedListQuery`) — the bar reports the fetch, and
          `stale` says the page on screen is still the previous one. */}
      <ListUpdatingRegion active={logsQuery.isFetching} stale={logsQuery.isStale}>
        {logs.length === 0 ? (
          <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t("common:columnCreatedAt")}</TableHead>
                <TableHead className="w-[35%]">{t("columnRequest")}</TableHead>
                <TableHead className="w-20">{t("columnStatus")}</TableHead>
                <TableHead>{t("columnMessage")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const requestLabel = `${log.method} ${log.path}`;
                return (
                  <TableRow key={log.id}>
                    <TableCell>{formatDateTime(log.createdAt, i18n.language)}</TableCell>
                    <TableCell title={requestLabel}>{requestLabel}</TableCell>
                    {/* Every entry here is a server-side failure (5xx), so
                        the status code is always shown as destructive —
                        never conveyed by color alone, since the numeric
                        code itself stays visible as text. */}
                    <TableCell className="text-destructive">{log.status}</TableCell>
                    <TableCell title={log.message}>{log.message}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ListUpdatingRegion>

      <Pagination
        page={logsQuery.page}
        pageSize={logsQuery.pageSize}
        total={logsQuery.total}
        onPageChange={(page) => setQuery((prev) => ({ ...prev, page }))}
        onPageSizeChange={(pageSize) => setQuery((prev) => ({ ...prev, pageSize, page: 1 }))}
      />
    </div>
  );
}
