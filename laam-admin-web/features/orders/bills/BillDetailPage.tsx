"use client";

import "@/i18n/client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatCurrencyKRW, formatDateTime } from "@/lib/utils";

import type { PaymentOrderStatus } from "../model";
import { paymentMethodLabel } from "../payment-method";
import type { BillDetail, BillPayment, BillPaymentState, BillStatus } from "./model";
import { useBillQuery } from "./queries";

// Translation keys in the `orders` namespace, not rendered text.
const BILL_STATUS_LABEL_KEY: Record<BillStatus, string> = {
  OPEN: "billDetailStatusOpen",
  PAID: "billDetailStatusPaid",
  CANCELLED: "billDetailStatusCancelled",
};

const BILL_STATUS_COLOR_CLASS: Record<BillStatus, string> = {
  OPEN: "text-warning",
  PAID: "text-success",
  CANCELLED: "text-muted-foreground",
};

const PAYMENT_STATE_LABEL_KEY: Record<BillPaymentState, string> = {
  APPROVED: "billDetailPaymentStateApproved",
  CANCELLED: "billDetailPaymentStateCancelled",
  UNDEFINED: "billDetailPaymentStateUndefined",
};

// Menu rows are `payment_orders`, so they reuse the order screens' status
// keys rather than the bill's own.
const MENU_STATUS_LABEL_KEY: Record<PaymentOrderStatus, string> = {
  READY: "statusReady",
  ACKNOWLEDGED: "statusAcknowledged",
  DONE: "statusDone",
  CANCELLED: "statusCancelled",
};

// The list screen's bill view, not router history: a bill detail is also
// opened from outside the list (e.g. a shared link), and the list toggle
// keeps its own view in the URL.
const BILL_LIST_HREF = "/orders?view=bill";

/**
 * 계산서 상세 (`/orders/bills/{billId}`) — one POS order with the payments
 * that settled it and the menu rows (`payment_orders`) rung onto it. Laid
 * out like `OrderDetailPage`: label/value cards for the bill itself, then
 * tables for its payments and menu rows, each menu row linking to its own
 * order detail.
 */
export function BillDetailPage({ billId }: { billId: string }) {
  const { t, i18n } = useTranslation("orders");
  const billQuery = useBillQuery(billId);

  if (billQuery.isLoading) {
    return <LoadingState label={t("billDetailLoading")} />;
  }

  if (billQuery.isError) {
    return (
      <ErrorState
        title={t("billDetailErrorTitle")}
        message={billQuery.error instanceof Error ? billQuery.error.message : undefined}
        onRetry={() => billQuery.refetch()}
      />
    );
  }

  const bill = billQuery.data;
  if (!bill) {
    return <EmptyState title={t("billDetailNotFoundTitle")} description={t("billDetailNotFoundDescription")} />;
  }

  const language = i18n.language;
  const formatAmount = (amount: number) => formatCurrencyKRW(amount, language);
  const formatTime = (value: string | undefined) => (value ? formatDateTime(value, language) : "-");

  const timeFields: Array<{ labelKey: string; value: string }> = [
    { labelKey: "billDetailFieldOpenedAt", value: formatTime(bill.openedAt) },
  ];
  if (bill.completedAt) {
    timeFields.push({ labelKey: "billDetailFieldCompletedAt", value: formatTime(bill.completedAt) });
  }
  if (bill.cancelledAt) {
    timeFields.push({ labelKey: "billDetailFieldCancelledAt", value: formatTime(bill.cancelledAt) });
  }

  const amountFields: Array<{ labelKey: string; value: string }> = [
    { labelKey: "billDetailFieldTotalAmount", value: formatAmount(bill.totalAmount) },
  ];
  if (bill.discountAmount !== null) {
    amountFields.push({ labelKey: "billDetailFieldDiscountAmount", value: formatAmount(bill.discountAmount) });
  }
  amountFields.push({ labelKey: "billDetailFieldPaidAmount", value: formatAmount(bill.paidAmount) });

  // A PAID bill whose full payment list hasn't been fetched yet may show
  // only the payments its webhooks carried so far.
  const paymentsMayBeIncomplete = bill.status === "PAID" && !bill.paymentsSyncedAt;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">{t("billDetailTitle")}</h1>
        <Link href={BILL_LIST_HREF} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("billDetailBackToList")}
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{t("billDetailTableHeading", { tableNumber: bill.tableNumber || "-" })}</span>
            <span className={cn("text-sm font-medium", BILL_STATUS_COLOR_CLASS[bill.status])}>
              {t(BILL_STATUS_LABEL_KEY[bill.status])}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {renderFields(timeFields)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("billDetailAmountsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">{renderFields(amountFields)}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("billDetailPaymentsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {paymentsMayBeIncomplete ? (
            <p role="note" className="text-sm text-warning">
              {t("billDetailPaymentsSyncPending")}
            </p>
          ) : null}
          {bill.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("billDetailPaymentsEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billDetailColumnPaymentMethod")}</TableHead>
                  <TableHead>{t("billDetailColumnCardBrand")}</TableHead>
                  <TableHead>{t("billDetailColumnApprovedNo")}</TableHead>
                  <TableHead>{t("billDetailColumnApprovedAt")}</TableHead>
                  <TableHead>{t("billDetailColumnAmount")}</TableHead>
                  <TableHead>{t("billDetailColumnPaymentState")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{bill.payments.map((payment) => renderPaymentRow(payment))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("billDetailMenuItemsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>{renderMenuItems(bill)}</CardContent>
      </Card>
    </div>
  );

  function renderFields(fields: Array<{ labelKey: string; value: string }>) {
    return fields.map((field) => (
      <div key={field.labelKey} className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{t(field.labelKey)}</span>
        <span className="text-sm text-foreground">{field.value}</span>
      </div>
    ));
  }

  function renderPaymentRow(payment: BillPayment) {
    const cancelled = payment.state === "CANCELLED";
    const methodLabel = paymentMethodLabel(payment.sourceType, t);
    // TossPlace's own method detail (e.g. "신용카드"), shown next to the
    // source-type label unless it would only repeat it.
    const methodDetail = payment.paymentMethod && payment.paymentMethod !== methodLabel ? payment.paymentMethod : "";
    return (
      <TableRow
        key={payment.id}
        data-payment-state={payment.state}
        className={cn(cancelled && "text-muted-foreground")}
      >
        <TableCell>
          <span>{methodLabel || "-"}</span>
          {methodDetail ? <span className="ml-1 text-muted-foreground">{methodDetail}</span> : null}
        </TableCell>
        <TableCell>{payment.cardBrand || "-"}</TableCell>
        <TableCell>{payment.approvedNo || "-"}</TableCell>
        <TableCell>{formatTime(payment.approvedAt)}</TableCell>
        <TableCell className={cn(cancelled && "line-through")}>{formatAmount(payment.amount)}</TableCell>
        <TableCell className={cn(cancelled ? "font-medium text-destructive" : "text-foreground")}>
          {t(PAYMENT_STATE_LABEL_KEY[payment.state] ?? "billDetailPaymentStateUndefined")}
        </TableCell>
      </TableRow>
    );
  }

  function renderMenuItems(bill: BillDetail) {
    if (bill.menuItems.length === 0) {
      return <p className="text-sm text-muted-foreground">{t("billDetailMenuItemsEmpty")}</p>;
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("billDetailColumnMenuItem")}</TableHead>
            <TableHead>{t("billDetailColumnCategory")}</TableHead>
            <TableHead>{t("billDetailColumnAmount")}</TableHead>
            <TableHead>{t("billDetailColumnStatus")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bill.menuItems.map((item) => (
            <TableRow key={item.orderId}>
              <TableCell>
                <Link
                  href={`/orders/${item.orderId}`}
                  className="text-foreground underline underline-offset-4 hover:font-bold"
                >
                  {item.menuItemName}
                </Link>
              </TableCell>
              <TableCell>{item.categoryName || "-"}</TableCell>
              <TableCell>{formatAmount(item.amount)}</TableCell>
              <TableCell>{t(MENU_STATUS_LABEL_KEY[item.status])}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
}
