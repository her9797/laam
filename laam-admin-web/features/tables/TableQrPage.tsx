"use client";

import "@/i18n/client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { AdminTable, TableArea } from "./model";
import { countUnlinkedTables, groupTablesByArea, linkedTables } from "./model";
import { downloadTablePng, downloadTableSvg, downloadTablesZip, generateQrPngDataUrl } from "./qr-export";
import { useAdminTablesQuery } from "./queries";

// Translation keys in the `tables` namespace, not rendered text. Areas the
// POS sync introduces are not in here and fall back to `areaLabelOther`.
const AREA_LABEL_KEY: Record<TableArea, string> = {
  B: "areaLabelB",
  T: "areaLabelT",
};

function areaLabel(t: (key: string, options?: Record<string, unknown>) => string, area: TableArea) {
  const key = AREA_LABEL_KEY[area];
  return key ? t(key) : t("areaLabelOther", { area });
}

function TableQrCard({ table }: { table: AdminTable }) {
  const { t } = useTranslation("tables");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    let cancelled = false;
    generateQrPngDataUrl(table.qrUrl)
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [table.qrUrl]);

  async function handleDownloadPng() {
    setDownloadError(null);
    try {
      await downloadTablePng(table);
    } catch {
      setDownloadError(t("downloadPngFailed"));
    }
  }

  async function handleDownloadSvg() {
    setDownloadError(null);
    try {
      await downloadTableSvg(table);
    } catch {
      setDownloadError(t("downloadSvgFailed"));
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(table.qrUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  const tableLabel = t("tableLabel", { id: table.id });

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-border p-4 print:break-inside-avoid">
      <p className="text-sm font-medium text-foreground">{tableLabel}</p>
      {qrDataUrl ? (
        <button
          type="button"
          className="w-32 max-w-full cursor-pointer print:pointer-events-none"
          title={t("copyLink")}
          onClick={handleCopyLink}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data: URL, not an optimizable remote asset */}
          <img src={qrDataUrl} alt={tableLabel} className="aspect-square w-full" />
        </button>
      ) : (
        <div className="flex aspect-square w-32 max-w-full items-center justify-center rounded bg-muted text-xs text-muted-foreground">
          {previewFailed ? t("downloadPngFailed") : null}
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2 print:hidden">
        <Button type="button" size="sm" variant="outline" onClick={handleDownloadPng}>
          {t("downloadPng")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={handleDownloadSvg}>
          {t("downloadSvg")}
        </Button>
      </div>
      {copyStatus === "copied" ? (
        <p role="status" aria-live="polite" className="text-xs text-emerald-600 dark:text-emerald-400 print:hidden">
          {t("linkCopied")}
        </p>
      ) : null}
      {copyStatus === "failed" ? (
        <p role="alert" className="text-xs text-destructive print:hidden">
          {t("linkCopyFailed")}
        </p>
      ) : null}
      {downloadError ? (
        <p role="alert" className="text-xs text-destructive print:hidden">
          {downloadError}
        </p>
      ) : null}
    </div>
  );
}

/**
 * `/tables/qr` — the printable QR codes, for the linked tables only.
 *
 * A table with no POS table behind it takes no orders, so its QR would send
 * the guest to a screen that cannot do anything: those tables are left out
 * of the grid, the ZIP and the print sheet alike, and the operator is sent
 * to `/tables` to link them instead.
 */
export function TableQrPage() {
  const { t } = useTranslation("tables");
  const tablesQuery = useAdminTablesQuery();
  const [zipError, setZipError] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);

  if (tablesQuery.isLoading) {
    return <LoadingState label={t("loading")} />;
  }

  if (tablesQuery.isError) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={tablesQuery.error instanceof Error ? tablesQuery.error.message : undefined}
        onRetry={() => tablesQuery.refetch()}
      />
    );
  }

  const allTables = tablesQuery.data?.tables ?? [];
  const tables = linkedTables(allTables);
  const unlinkedCount = countUnlinkedTables(allTables);
  const groups = groupTablesByArea(tables);

  async function handleDownloadAllZip() {
    setZipError(null);
    setIsZipping(true);
    try {
      await downloadTablesZip(tables);
    } catch {
      setZipError(t("downloadAllZipFailed"));
    } finally {
      setIsZipping(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  const tablesScreenLink = (
    <Link href="/tables" className={buttonVariants({ variant: "outline", size: "sm" })}>
      {t("goToTables")}
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-lg font-semibold text-foreground">{t("qrTitle")}</h1>
        {tables.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleDownloadAllZip} disabled={isZipping}>
              {t("downloadAllZip")}
            </Button>
            <Button type="button" variant="outline" onClick={handlePrint}>
              {t("printSheet")}
            </Button>
          </div>
        ) : null}
      </div>

      {zipError ? (
        <p role="alert" className="text-sm text-destructive print:hidden">
          {zipError}
        </p>
      ) : null}

      {/* Only when at least one table *is* linked: with none linked the empty
          state below already says the same thing, and says it as the whole
          screen rather than as a note above an empty grid. */}
      {unlinkedCount > 0 && tables.length > 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-muted/40 p-4 print:hidden">
          <p className="text-sm text-foreground">{t("qrUnlinkedNotice", { count: unlinkedCount })}</p>
          {tablesScreenLink}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState
          title={t("qrEmptyTitle")}
          description={t("qrEmptyDescription")}
          action={
            <Link href="/tables" className={cn(buttonVariants(), "mt-2")}>
              {t("goToTables")}
            </Link>
          }
        />
      ) : (
        groups.map((group) => (
          <section key={group.area} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground print:text-foreground">
              {areaLabel(t, group.area)}
            </h2>
            {/* Five columns only from `xl`: from `md` on the desktop sidebar takes
                its width, and five columns under ~1200px are narrower than a
                card's full-size QR preview and PNG/SVG row. */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5 print:grid-cols-3">
              {group.tables.map((table) => (
                <TableQrCard key={table.id} table={table} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
