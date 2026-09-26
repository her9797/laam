"use client";

import "@/i18n/client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { RiArrowDownSLine } from "@remixicon/react";

import { ListTotalCount } from "@/components/list/ListTotalCount";
import { ListUpdatingRegion } from "@/components/list/ListUpdatingRegion";
import { Pagination } from "@/components/list/Pagination";
import { EmptyState, ErrorState, ListSkeletonState } from "@/components/states/PageStates";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRetainedListQuery } from "@/hooks/use-retained-list-query";
import { cn, formatCurrencyKRW, formatDateTime, resolveDateTimeLocale } from "@/lib/utils";

import { paymentMethodLabel } from "../payment-method";
import type { Bill, BillListQuery, BillPaymentState, BillStatus } from "./model";
import { useBillsPageQuery } from "./queries";

export type BillListViewProps = {
  query: BillListQuery;
  /** False while the parent's date range is still unresolved (see `OrderListPage`). */
  enabled: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

const COLUMN_COUNT = 6;

// Translation keys in the `orders` namespace, not rendered text.
const STATUS_LABEL_KEY: Record<BillStatus, string> = {
  OPEN: "billListStatusOpen",
  PAID: "billListStatusPaid",
  CANCELLED: "billListStatusCancelled",
};

// Same palette as the menu-row list (`OrderListPage`): an unpaid bill needs
// attention, a paid one is the settled outcome, a cancelled one is inert.
const STATUS_COLOR_CLASS: Record<BillStatus, string> = {
  OPEN: "text-warning",
  PAID: "text-success",
  CANCELLED: "text-muted-foreground",
};

type PaymentGroup = { label: string; amount: number; state: BillPaymentState };

/**
 * Sums a bill's payments per (method, state), keeping first-seen order, so
 * two card swipes read as one "카드" entry while a cancelled card payment
 * stays a separate, visibly-cancelled entry instead of inflating the paid
 * line.
 */
function groupPayments(bill: Bill, t: (key: string) => string): PaymentGroup[] {
  const groups = new Map<string, PaymentGroup>();
  for (const payment of bill.payments) {
    // `sourceType` is TossPlace's `PaymentSourceType` (CARD, CASH, ...),
    // which is what `paymentMethodLabel` knows; `paymentMethod` is only a
    // fallback for a payment recorded without one.
    const label = paymentMethodLabel(payment.sourceType || payment.paymentMethod, t);
    const key = `${payment.state}\u0000${label}`;
    const existing = groups.get(key);
    if (existing) {
      existing.amount += payment.amount;
    } else {
      groups.set(key, { label, amount: payment.amount, state: payment.state });
    }
  }
  return [...groups.values()];
}

function BillPayments({ bill }: { bill: Bill }) {
  const { t, i18n } = useTranslation("orders");
  const numberFormat = new Intl.NumberFormat(resolveDateTimeLocale(i18n.language));
  const groups = groupPayments(bill, t);

  if (groups.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  const describe = (group: PaymentGroup) => `${group.label} ${numberFormat.format(group.amount)}`;
  const approved = groups.filter((group) => group.state === "APPROVED");
  const unconfirmed = groups.filter((group) => group.state === "UNDEFINED");
  const cancelled = groups.filter((group) => group.state === "CANCELLED");

  return (
    <div className="flex flex-col gap-0.5">
      {approved.length > 0 ? <span>{approved.map(describe).join(" · ")}</span> : null}
      {unconfirmed.map((group) => (
        <span key={`undefined-${group.label}`} className="text-warning">
          {t("billListPaymentUnconfirmed", { payment: describe(group) })}
        </span>
      ))}
      {cancelled.map((group) => (
        <span key={`cancelled-${group.label}`} className="text-muted-foreground line-through">
          {t("billListPaymentCancelled", { payment: describe(group) })}
        </span>
      ))}
    </div>
  );
}

/**
 * Bill-grouped (계산서별) order history: one row per POS order, with its
 * payments summarised and its menu rows behind an expand toggle. Paging and
 * failure handling follow the menu-row list (`OrderListPage`).
 */
export function BillListView({ query, enabled, onPageChange, onPageSizeChange }: BillListViewProps) {
  const { t, i18n } = useTranslation("orders");
  const billsQuery = useRetainedListQuery(useBillsPageQuery(query, enabled), query);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);

  if (billsQuery.isLoading || (!enabled && !billsQuery.data)) {
    return <ListSkeletonState columns={COLUMN_COUNT} label={t("billListLoading")} />;
  }

  // Only a failure with nothing preserved behind it replaces the list; a
  // failed page change or refetch keeps the rows under an inline error.
  if (billsQuery.isError && !billsQuery.data) {
    return (
      <ErrorState
        title={t("billListErrorTitle")}
        message={billsQuery.error instanceof Error ? billsQuery.error.message : undefined}
        onRetry={() => billsQuery.refetch()}
      />
    );
  }

  const bills = billsQuery.data?.items ?? [];
  const hasActiveFilter =
    Boolean(query.status) || Boolean(query.sourceType) || query.search.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      {billsQuery.isError ? (
        <ErrorState
          title={billsQuery.isRetained ? t("common:listRetainedErrorTitle") : t("billListErrorTitle")}
          message={billsQuery.error instanceof Error ? billsQuery.error.message : undefined}
          onRetry={() => billsQuery.refetch()}
        />
      ) : null}

      <ListTotalCount count={billsQuery.total} />

      <ListUpdatingRegion active={billsQuery.isFetching} stale={billsQuery.isStale}>
        {bills.length === 0 ? (
          hasActiveFilter ? (
            <EmptyState
              title={t("common:listNoResultsTitle")}
              description={t("common:listNoResultsDescription")}
            />
          ) : (
            <EmptyState title={t("billListEmptyTitle")} description={t("billListEmptyDescription")} />
          )
        ) : (
          // Same narrow-screen strategy as the menu-row table: a fixed
          // minimum width inside the table's own `overflow-x-auto` container,
          // so a phone scrolls the table sideways instead of crushing columns.
          <Table className="min-w-[48rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">{t("billListColumnOpenedAt")}</TableHead>
                <TableHead className="w-20">{t("common:columnTable")}</TableHead>
                <TableHead className="w-32">{t("billListColumnMenu")}</TableHead>
                <TableHead>{t("billListColumnPayments")}</TableHead>
                <TableHead className="w-28">{t("billListColumnTotal")}</TableHead>
                <TableHead className="w-24">{t("billListColumnStatus")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((bill) => {
                const expanded = expandedBillId === bill.id;
                const panelId = `bill-menu-${bill.id}`;
                const moreCount = bill.menuCount - bill.menuPreview.length;
                const menuText = [
                  bill.menuPreview.join(" · "),
                  moreCount > 0 ? t("billListMenuMore", { count: moreCount }) : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <Fragment key={bill.id}>
                    <TableRow>
                      <TableCell className="align-top">
                        <Link
                          href={`/orders/bills/${encodeURIComponent(bill.id)}`}
                          className="text-foreground underline underline-offset-4 hover:font-bold"
                        >
                          {formatDateTime(bill.openedAt, i18n.language)}
                        </Link>
                        {bill.status === "PAID" && bill.completedAt ? (
                          <div className="text-xs text-muted-foreground">
                            {t("billListCompletedAt", {
                              time: formatDateTime(bill.completedAt, i18n.language),
                            })}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">{bill.tableNumber || "-"}</TableCell>
                      <TableCell className="align-top">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="-ml-2"
                          aria-expanded={expanded}
                          aria-controls={panelId}
                          disabled={bill.menuCount === 0}
                          onClick={() => setExpandedBillId(expanded ? null : bill.id)}
                        >
                          {t("billListMenuCount", { count: bill.menuCount })}
                          <RiArrowDownSLine
                            data-icon="inline-end"
                            aria-hidden="true"
                            className={cn("transition-transform", expanded && "rotate-180")}
                          />
                        </Button>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <BillPayments bill={bill} />
                      </TableCell>
                      <TableCell className="align-top">
                        {formatCurrencyKRW(bill.totalAmount, i18n.language)}
                      </TableCell>
                      <TableCell className={cn("align-top", STATUS_COLOR_CLASS[bill.status])}>
                        {t(STATUS_LABEL_KEY[bill.status])}
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow id={panelId} className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={COLUMN_COUNT} className="whitespace-normal text-muted-foreground">
                          {menuText || "-"}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ListUpdatingRegion>

      <Pagination
        page={billsQuery.page}
        pageSize={billsQuery.pageSize}
        total={billsQuery.total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}
