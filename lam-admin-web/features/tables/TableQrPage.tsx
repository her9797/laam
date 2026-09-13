"use client";

import "@/i18n/client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Button } from "@/components/ui/button";

import type { AdminTable, TableArea } from "./model";
import { groupTablesByArea } from "./model";
import { downloadTablePng, downloadTableSvg, downloadTablesZip, generateQrPngDataUrl } from "./qr-export";
import { useAdminTablesQuery } from "./queries";

// Translation keys in the `tables` namespace, not rendered text.
const AREA_LABEL_KEY: Record<TableArea, string> = {
  B: "areaLabelB",
  T: "areaLabelT",
};

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
          className="size-32 cursor-pointer print:pointer-events-none"
          title={t("copyLink")}
          onClick={handleCopyLink}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data: URL, not an optimizable remote asset */}
          <img src={qrDataUrl} alt={tableLabel} className="size-32" />
        </button>
      ) : (
        <div className="flex size-32 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
          {previewFailed ? t("downloadPngFailed") : null}
        </div>
      )}
      <div className="flex gap-2 print:hidden">
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

  const tables = tablesQuery.data ?? [];
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleDownloadAllZip} disabled={isZipping}>
            {t("downloadAllZip")}
          </Button>
          <Button type="button" variant="outline" onClick={handlePrint}>
            {t("printSheet")}
          </Button>
        </div>
      </div>

      {zipError ? (
        <p role="alert" className="text-sm text-destructive print:hidden">
          {zipError}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState title={t("errorTitle")} />
      ) : (
        groups.map((group) => (
          <section key={group.area} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground print:text-foreground">
              {t(AREA_LABEL_KEY[group.area])}
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5 print:grid-cols-3">
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
