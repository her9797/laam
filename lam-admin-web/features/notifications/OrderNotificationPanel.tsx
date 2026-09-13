"use client";

import "@/i18n/client";

import { useTranslation } from "react-i18next";

import { formatCurrencyKRW, formatDateTime } from "@/lib/utils";

import type { OrderNotification } from "./model";

export type OrderNotificationPanelProps = {
  notifications: OrderNotification[];
  onItemClick: (order: OrderNotification) => void;
};

export function OrderNotificationPanel({ notifications, onItemClick }: OrderNotificationPanelProps) {
  const { t, i18n } = useTranslation("notifications");

  return (
    <div className="flex max-h-[28rem] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-foreground/5 px-4 py-3">
        <span className="font-heading text-sm font-medium">{t("ordersPanelTitle")}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {notifications.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("ordersEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {notifications.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => onItemClick(order)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-2xl px-3 py-2 text-left text-sm hover:bg-foreground/5"
                >
                  <span className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{t("kindOrder")}</span>
                    <span>{formatDateTime(order.approvedAt, i18n.language)}</span>
                  </span>
                  <span className="line-clamp-2 w-full text-foreground">
                    {order.tableNumber} · {order.menuItemName} · {formatCurrencyKRW(order.amount, i18n.language)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
