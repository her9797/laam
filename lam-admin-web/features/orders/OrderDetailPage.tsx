"use client";

import "@/i18n/client";

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { formatCurrencyKRW, formatDateTime } from "@/lib/utils";

import type { PaymentOrder, PaymentOrderPosSyncStatus, PaymentOrderStatus } from "./model";
import { useAcknowledgeOrderMutation, useOrderQuery } from "./queries";

// Translation keys in the `orders` namespace, not rendered text. Mirrors
// `OrderListPage`'s own copies — kept separate rather than shared, since
// each is a small, self-contained lookup local to the component that
// renders it.
const STATUS_LABEL_KEY: Record<PaymentOrderStatus, string> = {
  READY: "statusReady",
  ACKNOWLEDGED: "statusAcknowledged",
  DONE: "statusDone",
  CANCELLED: "statusCancelled",
};

const POS_SYNC_LABEL_KEY: Record<PaymentOrderPosSyncStatus, string> = {
  PENDING: "posSyncPending",
  SUCCEEDED: "posSyncSucceeded",
  FAILED: "posSyncFailed",
  NOT_CONFIGURED: "posSyncNotConfigured",
};

// Field groups for the detail screen's two cards, in display order —
// mirrors `MenuItemDetailPage`'s basic-info/recipe card split, grouping by
// what an operator reads together (order/menu facts, then payment/POS
// facts) rather than by the wire shape. Labels are keys in the `orders`
// namespace. Optional fields (e.g. `paymentKey` on an unpaid `READY`
// order) fall back to "-" at render time rather than being filtered out,
// so each card's shape stays identical regardless of the order's status.
const ORDER_INFO_FIELDS: Array<{ key: keyof PaymentOrder; labelKey: string }> = [
  { key: "tableNumber", labelKey: "fieldTableNumber" },
  { key: "menuItemName", labelKey: "fieldMenuItem" },
  { key: "categoryName", labelKey: "fieldCategory" },
  { key: "requestNote", labelKey: "fieldRequestNote" },
  { key: "amount", labelKey: "fieldAmount" },
  { key: "vat", labelKey: "fieldVat" },
  { key: "suppliedAmount", labelKey: "fieldSuppliedAmount" },
  { key: "taxFreeAmount", labelKey: "fieldTaxFreeAmount" },
  { key: "status", labelKey: "fieldStatus" },
  { key: "createdAt", labelKey: "fieldCreatedAt" },
];

const PAYMENT_INFO_FIELDS: Array<{ key: keyof PaymentOrder; labelKey: string }> = [
  { key: "paymentMethod", labelKey: "fieldPaymentMethod" },
  { key: "paymentKey", labelKey: "fieldPaymentKey" },
  { key: "approvedAt", labelKey: "fieldApprovedAt" },
  { key: "posSyncStatus", labelKey: "fieldPosSyncStatus" },
  { key: "posOrderId", labelKey: "fieldPosOrderId" },
  { key: "posSyncError", labelKey: "fieldPosSyncError" },
];

const AMOUNT_FIELD_KEYS: Set<keyof PaymentOrder> = new Set(["amount", "vat", "suppliedAmount", "taxFreeAmount"]);
const DATE_FIELD_KEYS: Set<keyof PaymentOrder> = new Set(["approvedAt", "createdAt"]);

/**
 * Order-detail screen (`/orders/{orderId}`) — a dedicated route rather than
 * the list's former inline dialog, so the detail view is deep-linkable and
 * survives a refresh. Laid out as two label/value cards, matching
 * `MenuItemDetailPage`'s basic-info card (same `Card`/grid/label-value
 * structure), rather than the earlier flat `<dl>` list.
 *
 * The paymentKey shown here reaching the URL was the concern that kept the
 * old dialog off the address bar; that concern doesn't apply to the route
 * itself, since only the order id — not the payment key — appears in the
 * URL. The payment key stays in the response body only.
 *
 * "목록으로" goes back via browser/router history (`router.back()`) rather
 * than a fixed `href="/orders"`, so returning from here restores whatever
 * filters/page/sort the operator had on the list — the list's own filters
 * already live entirely in its URL (`list-query-url.ts`), so the previous
 * history entry already encodes them. Per this feature's scope, that
 * restoration is deliberately tied to *actual* back navigation (this
 * button, or the browser's own back control) — a direct or bookmarked
 * load of this URL has no such history entry, so the button is a no-op in
 * that rare case rather than a route worth engineering around.
 */
export function OrderDetailPage({ orderId }: { orderId: string }) {
  const { t, i18n } = useTranslation("orders");
  const router = useRouter();
  const orderQuery = useOrderQuery(orderId);
  const acknowledgeMutation = useAcknowledgeOrderMutation();

  if (orderQuery.isLoading) {
    return <LoadingState label={t("loading")} />;
  }

  if (orderQuery.isError) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={orderQuery.error instanceof Error ? orderQuery.error.message : undefined}
        onRetry={() => orderQuery.refetch()}
      />
    );
  }

  const order = orderQuery.data;
  if (!order) {
    return <EmptyState title={t("detailNotFoundTitle")} description={t("detailNotFoundDescription")} />;
  }

  function renderDetailValue(order: PaymentOrder, key: keyof PaymentOrder): string {
    const value = order[key];
    if (value === undefined || value === "") {
      return "-";
    }
    if (key === "status") {
      return t(STATUS_LABEL_KEY[order.status]);
    }
    if (key === "posSyncStatus") {
      return t(POS_SYNC_LABEL_KEY[order.posSyncStatus]);
    }
    if (AMOUNT_FIELD_KEYS.has(key)) {
      return formatCurrencyKRW(value as number, i18n.language);
    }
    if (DATE_FIELD_KEYS.has(key)) {
      return formatDateTime(value as string, i18n.language);
    }
    return String(value);
  }

  function renderFieldGroup(order: PaymentOrder, fields: Array<{ key: keyof PaymentOrder; labelKey: string }>) {
    return fields.map((field) => (
      <div key={field.key} className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{t(field.labelKey)}</span>
        <span className="text-sm text-foreground">{renderDetailValue(order, field.key)}</span>
      </div>
    ));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">{t("detailTitle")}</h1>
        <div className="flex items-center gap-2">
          {order.status === "READY" ? (
            <Button
              type="button"
              size="sm"
              disabled={acknowledgeMutation.isPending}
              onClick={() => acknowledgeMutation.mutate(order.orderId)}
            >
              {t("detailAcknowledgeButton")}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => router.back()}>
            {t("detailBackToList")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("detailOrderInfoTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {renderFieldGroup(order, ORDER_INFO_FIELDS)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("detailPaymentInfoTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {renderFieldGroup(order, PAYMENT_INFO_FIELDS)}
        </CardContent>
      </Card>
    </div>
  );
}
