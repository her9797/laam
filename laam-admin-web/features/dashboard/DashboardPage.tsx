"use client";

import "@/i18n/client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { useBootstrapQuery } from "@/features/bootstrap/queries";
import { useOrderCountQuery } from "@/features/orders/queries";
import { useCustomerRequestPendingSummaryQuery } from "@/features/requests/queries";
import { useSpecialRequestCountQuery } from "@/features/special-requests/queries";

import { buildDashboardSummary, type DashboardSummary } from "./summary";

type ShortcutCard = {
  key: string;
  href: string;
  /** Key in the `dashboard` namespace, resolved at render. */
  titleKey: string;
  descriptionKey: string;
  value: number;
};

// Every card links to the management route for the data it counts — the
// three built in this task (`/requests`, `/song-requests`,
// `/special-requests`) plus the menu/notice routes `AdminShell`'s nav
// already lists (Task 3) and Tasks 6/7 will implement, and `/orders` for
// the order-history count. Linking ahead here matches the nav, which
// already does the same.
function buildCards(summary: DashboardSummary): ShortcutCard[] {
  return [
    {
      key: "general",
      href: "/requests",
      titleKey: "cardGeneralTitle",
      descriptionKey: "cardGeneralDescription",
      value: summary.pendingGeneralRequestCount,
    },
    {
      key: "song",
      href: "/song-requests",
      titleKey: "cardSongTitle",
      descriptionKey: "cardSongDescription",
      value: summary.pendingSongRequestCount,
    },
    {
      key: "special",
      href: "/special-requests",
      titleKey: "cardSpecialTitle",
      descriptionKey: "cardSpecialDescription",
      value: summary.specialRequestCount,
    },
    {
      key: "orders",
      href: "/orders?status=READY",
      titleKey: "cardOrdersTitle",
      descriptionKey: "cardOrdersDescription",
      value: summary.orderCount,
    },
    {
      key: "menu",
      href: "/menu",
      titleKey: "cardMenuTitle",
      descriptionKey: "cardMenuDescription",
      value: summary.menuItemCount,
    },
    {
      key: "notices",
      href: "/notices",
      titleKey: "cardNoticesTitle",
      descriptionKey: "cardNoticesDescription",
      value: summary.noticeCount,
    },
  ];
}

export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const bootstrapQuery = useBootstrapQuery();
  const requestsQuery = useCustomerRequestPendingSummaryQuery();
  const specialRequestCountQuery = useSpecialRequestCountQuery();
  const orderCountQuery = useOrderCountQuery();

  const isLoading =
    bootstrapQuery.isLoading ||
    requestsQuery.isLoading ||
    specialRequestCountQuery.isLoading ||
    orderCountQuery.isLoading;
  const failedQuery = [bootstrapQuery, requestsQuery, specialRequestCountQuery, orderCountQuery].find(
    (query) => query.isError,
  );

  function retryAll() {
    if (bootstrapQuery.isError) {
      void bootstrapQuery.refetch();
    }
    if (requestsQuery.isError) {
      void requestsQuery.refetch();
    }
    if (specialRequestCountQuery.isError) {
      void specialRequestCountQuery.refetch();
    }
    if (orderCountQuery.isError) {
      void orderCountQuery.refetch();
    }
  }

  if (isLoading) {
    return <LoadingState label={t("loading")} />;
  }

  if (
    failedQuery ||
    !bootstrapQuery.data ||
    !requestsQuery.data ||
    !specialRequestCountQuery.data ||
    !orderCountQuery.data
  ) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={
          failedQuery?.error instanceof Error ? failedQuery.error.message : undefined
        }
        onRetry={retryAll}
      />
    );
  }

  const summary = buildDashboardSummary(
    bootstrapQuery.data,
    requestsQuery.data,
    specialRequestCountQuery.data.total,
    orderCountQuery.data.total,
  );
  // All 4 queries have already succeeded above (the loading/error branches
  // returned first) — "empty" here means every aggregate count is genuinely
  // zero: no pending general or song requests, no special or order-history
  // records, no menu items, no notices. That's the only state where a bare
  // "0" on every card would otherwise look indistinguishable from a
  // data-loading problem.
  const isEmpty =
    summary.pendingGeneralRequestCount === 0 &&
    summary.pendingSongRequestCount === 0 &&
    summary.specialRequestCount === 0 &&
    summary.orderCount === 0 &&
    summary.menuItemCount === 0 &&
    summary.noticeCount === 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
      {isEmpty ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {buildCards(summary).map((card) => (
            <Link key={card.key} href={card.href} className="block">
              <Card className="transition-shadow hover:shadow-lg">
                <CardHeader>
                  <CardTitle>{t(card.titleKey)}</CardTitle>
                  <CardDescription>{t(card.descriptionKey)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold text-foreground">{card.value}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
