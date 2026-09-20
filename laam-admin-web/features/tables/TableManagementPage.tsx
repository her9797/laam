"use client";

import "@/i18n/client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

import { ErrorState, LoadingState } from "@/components/states/PageStates";
import { buttonVariants } from "@/components/ui/button";

import { PosTableLinkSection } from "./PosTableLinkSection";
import { useAdminTablesQuery } from "./queries";

/**
 * `/tables` — the POS side of the tables: pull the POS's table list, link
 * each QR table to a POS table, add the POS-only ones, and correct a QR
 * table's own code.
 *
 * The QR codes themselves live on `/tables/qr` (`TableQrPage`), because only
 * a *linked* table gets one: a QR printed for an unlinked table sends the
 * guest to a screen that cannot take an order.
 */
export function TableManagementPage() {
  const { t } = useTranslation("tables");
  const tablesQuery = useAdminTablesQuery();

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

  const data = tablesQuery.data ?? {
    tables: [],
    posOnlyTables: [],
    lastSyncedAt: null,
    pendingSync: null,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <Link href="/tables/qr" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("goToQr")}
        </Link>
      </div>

      <PosTableLinkSection data={data} />
    </div>
  );
}
