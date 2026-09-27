"use client";

import "@/i18n/client";

import Link from "next/link";
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

/**
 * Groups a bill's menu names in first-seen order, so three highballs read as
 * one "Highball ×3" line instead of three identical ones.
 */
function groupMenus(names: string[]): { name: string; count: number }[] {
  const groups = new Map<string, number>();
  for (const name of names) {
    groups.set(name, (groups.get(name) ?? 0) + 1);
  }
  return [...groups].map(([name, count]) => ({ name, count }));
}

function BillMenus({ bill }: { bill: Bill }) {
  const { t } = useTranslation("orders");
  const menus = groupMenus(bill.menuPreview);

  if (menus.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <ul aria-label={t("billListColumnMenu")} className="flex flex-col gap-0.5">
      {menus.map((menu) => (
        <li key={menu.name}>
          {menu.count > 1 ? t("billListMenuQuantity", { name: menu.name, count: menu.count }) : menu.name}
        </li>
      ))}
    </ul>
  );
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
 * payments summarised and every menu listed in its row. Paging and
 * failure handling follow the menu-row list (`OrderListPage`).
 */
export function BillListView({ query, enabled, onPageChange, onPageSizeChange }: BillListViewProps) {
  const { t, i18n } = useTranslation("orders");
  const billsQuery = useRetainedListQuery(useBillsPageQuery(query, enabled), query);

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
                <TableHead>{t("billListColumnMenu")}</TableHead>
                <TableHead>{t("billListColumnPayments")}</TableHead>
                <TableHead className="w-28">{t("billListColumnTotal")}</TableHead>
                <TableHead className="w-24">{t("billListColumnStatus")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((bill) => (
                <TableRow key={bill.id}>
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
                  <TableCell className="align-top whitespace-normal">
                    <BillMenus bill={bill} />
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
              ))}
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
