"use client";

import "@/i18n/client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { FetchJsonError } from "@/lib/api/fetch-json";
import { formatDateTime } from "@/lib/utils";

import type { AdminTable, AdminTablesData, PosTable, PosTableSync } from "./model";
import { countUnlinkedTables, formatPosTableSummary } from "./model";
import {
  useCreateQrTableMutation,
  usePosTableSyncMutation,
  useUpdateTablePosLinkMutation,
} from "./queries";

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function hasStatus(error: unknown, status: number): boolean {
  return error instanceof FetchJsonError && error.status === status;
}

/**
 * The POS side of the table screen: pull the POS's table list, then link
 * each QR table to a POS table. A QR table with no POS table behind it is
 * not orderable, so the unlinked count is surfaced as a warning above the
 * list rather than only as a per-row state.
 */
export function PosTableLinkSection({ data }: { data: AdminTablesData }) {
  const { t, i18n } = useTranslation("tables");
  const syncMutation = usePosTableSyncMutation();
  const linkMutation = useUpdateTablePosLinkMutation();
  const createMutation = useCreateQrTableMutation();

  /** POS table the operator picked in an unlinked row's select, per QR table id. */
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({});
  /** POS tables whose "add as QR table" needs an operator-typed id (the server's 400). */
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});

  const unlinkedCount = countUnlinkedTables(data.tables);
  const isSyncing = syncMutation.isPending || data.pendingSync !== null;

  function handleSyncFinished(sync: PosTableSync) {
    if (sync.status === "TIMED_OUT") {
      toast.add({ title: t("posSyncTimedOut") });
      return;
    }
    if (sync.status === "FAILED") {
      toast.add({ title: t("posSyncFailedTitle"), description: sync.error ?? undefined });
      return;
    }
    // The three counts are the state *after* the sync — how many QR tables
    // ended up linked, how many still need linking, and how many POS tables
    // have no QR table — not what this run changed.
    toast.add({
      title: t("posSyncSuccessTitle"),
      description: t("posSyncSuccessDescription", {
        linked: sync.linkedCount,
        unlinked: sync.unlinkedCount,
        posOnly: sync.posOnlyCount,
      }),
    });
  }

  function handleSync() {
    syncMutation.mutate(undefined, {
      onSuccess: (sync: PosTableSync) => handleSyncFinished(sync),
      onError: (error: unknown) => {
        toast.add({ title: t("posSyncFailedTitle"), description: errorMessage(error) });
      },
    });
  }

  function handleLink(qrTableId: string, posTableId: number | null) {
    linkMutation.mutate(
      { qrTableId, posTableId },
      {
        onSuccess: () => {
          setLinkDrafts((current) => {
            const next = { ...current };
            delete next[qrTableId];
            return next;
          });
          toast.add({ title: posTableId === null ? t("linkRemoved") : t("linkSaved") });
        },
        onError: (error: unknown) => {
          if (hasStatus(error, 409)) {
            toast.add({ title: t("linkConflict") });
            return;
          }
          if (hasStatus(error, 404)) {
            toast.add({ title: t("linkNotFound") });
            return;
          }
          toast.add({ title: t("linkFailed"), description: errorMessage(error) });
        },
      },
    );
  }

  function handleAddQrTable(posTableId: number, id?: string) {
    createMutation.mutate(
      id === undefined ? { posTableId } : { posTableId, id },
      {
        onSuccess: () => {
          setNameDrafts((current) => {
            const next = { ...current };
            delete next[posTableId];
            return next;
          });
          toast.add({ title: t("posOnlyAdded") });
        },
        onError: (error: unknown) => {
          // The server could not derive a QR name from the POS one — ask for
          // it instead of failing, and retry with what the operator types.
          if (hasStatus(error, 400) && id === undefined) {
            setNameDrafts((current) => ({ ...current, [posTableId]: "" }));
            return;
          }
          if (hasStatus(error, 409)) {
            toast.add({ title: t("posOnlyAddConflict") });
            return;
          }
          toast.add({ title: t("posOnlyAddFailed"), description: errorMessage(error) });
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4 print:hidden">
      {unlinkedCount > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-2xl border border-destructive/50 bg-destructive/10 p-4"
        >
          <p className="text-sm font-semibold text-destructive">{t("unlinkedWarningTitle")}</p>
          <p className="text-sm text-foreground">
            {t("unlinkedWarningDescription", { count: unlinkedCount })}
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("posSectionTitle")}</CardTitle>
          <CardDescription>{t("posSectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" disabled={isSyncing} onClick={handleSync}>
              {isSyncing ? t("posSyncButtonPending") : t("posSyncButton")}
            </Button>
            <p className="text-sm text-muted-foreground">
              {data.lastSyncedAt
                ? t("posLastSyncedAt", { at: formatDateTime(data.lastSyncedAt, i18n.language) })
                : t("posNeverSynced")}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("posSummary", { unlinked: unlinkedCount, posOnly: data.posOnlyTables.length })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("linkSectionTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {data.tables.map((table) => (
              <TableLinkRow
                key={table.id}
                table={table}
                posOnlyTables={data.posOnlyTables}
                draft={linkDrafts[table.id] ?? ""}
                isPending={linkMutation.isPending}
                onDraftChange={(value) =>
                  setLinkDrafts((current) => ({ ...current, [table.id]: value }))
                }
                onLink={handleLink}
              />
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("posOnlySectionTitle")}</CardTitle>
          <CardDescription>{t("posOnlySectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.posOnlyTables.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("posOnlyEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.posOnlyTables.map((posTable) => (
                <PosOnlyRow
                  key={posTable.posTableId}
                  posTable={posTable}
                  nameDraft={nameDrafts[posTable.posTableId]}
                  isPending={createMutation.isPending}
                  onNameDraftChange={(value) =>
                    setNameDrafts((current) => ({ ...current, [posTable.posTableId]: value }))
                  }
                  onCancelName={() =>
                    setNameDrafts((current) => {
                      const next = { ...current };
                      delete next[posTable.posTableId];
                      return next;
                    })
                  }
                  onAdd={handleAddQrTable}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TableLinkRow({
  table,
  posOnlyTables,
  draft,
  isPending,
  onDraftChange,
  onLink,
}: {
  table: AdminTable;
  posOnlyTables: PosTable[];
  draft: string;
  isPending: boolean;
  onDraftChange: (value: string) => void;
  onLink: (qrTableId: string, posTableId: number | null) => void;
}) {
  const { t } = useTranslation("tables");
  const isLinked = table.posTableId !== null;
  const selectId = `pos-link-${table.id}`;

  return (
    <li
      aria-label={t("tableLabel", { id: table.id })}
      className="flex flex-col gap-2 rounded-2xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{table.id}</span>
        {isLinked ? (
          <span className="truncate text-sm text-muted-foreground">
            {formatPosTableSummary(table.posTableTitle, table.hallName)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            isLinked ? "text-xs text-muted-foreground" : "text-xs font-semibold text-destructive"
          }
        >
          {isLinked ? t("linkStatusLinked") : t("linkStatusUnlinked")}
        </span>
        {isLinked ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => onLink(table.id, null)}
          >
            {t("linkUnlink")}
          </Button>
        ) : (
          <>
            {/* Native select, like the menu/inventory forms: it opens the
                phone's own picker and needs no floating popup inside a row. */}
            <select
              id={selectId}
              aria-label={t("posTableSelectLabel", { id: table.id })}
              className="h-9 max-w-44 rounded-3xl border border-transparent bg-input/50 px-3 text-sm text-foreground"
              value={draft}
              disabled={posOnlyTables.length === 0}
              onChange={(event) => onDraftChange(event.target.value)}
            >
              <option value="">
                {posOnlyTables.length === 0
                  ? t("posTableSelectEmpty")
                  : t("posTableSelectPlaceholder")}
              </option>
              {posOnlyTables.map((posTable) => (
                <option key={posTable.posTableId} value={String(posTable.posTableId)}>
                  {formatPosTableSummary(posTable.title, posTable.hallName)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={isPending || draft === ""}
              onClick={() => onLink(table.id, Number(draft))}
            >
              {t("linkSave")}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function PosOnlyRow({
  posTable,
  nameDraft,
  isPending,
  onNameDraftChange,
  onCancelName,
  onAdd,
}: {
  posTable: PosTable;
  /** `undefined` until the server asked for an operator-typed QR table id. */
  nameDraft: string | undefined;
  isPending: boolean;
  onNameDraftChange: (value: string) => void;
  onCancelName: () => void;
  onAdd: (posTableId: number, id?: string) => void;
}) {
  const { t } = useTranslation("tables");
  const inputId = `qr-table-id-${posTable.posTableId}`;
  const hintId = `${inputId}-hint`;
  const needsName = nameDraft !== undefined;

  return (
    <li
      aria-label={posTable.title}
      className="flex flex-col gap-2 rounded-2xl border border-border p-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="truncate text-sm text-foreground">
          {formatPosTableSummary(posTable.title, posTable.hallName)}
        </span>
        {needsName ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => onAdd(posTable.posTableId)}
          >
            {t("posOnlyAdd")}
          </Button>
        )}
      </div>

      {needsName ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>{t("posOnlyAddIdLabel")}</Label>
          <p id={hintId} className="text-xs text-muted-foreground">
            {t("posOnlyAddIdHint")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={inputId}
              aria-describedby={hintId}
              className="max-w-36"
              value={nameDraft}
              onChange={(event) => onNameDraftChange(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={isPending || nameDraft.trim() === ""}
              onClick={() => onAdd(posTable.posTableId, nameDraft.trim().toUpperCase())}
            >
              {t("posOnlyAddSubmit")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancelName}>
              {t("posOnlyAddCancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
