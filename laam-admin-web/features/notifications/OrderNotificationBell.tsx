"use client";

import "@/i18n/client";

import { RiShoppingCart2Line } from "@remixicon/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { cn, formatCurrencyKRW } from "@/lib/utils";

import type { OrderNotification } from "./model";
import { OrderNotificationPanel } from "./OrderNotificationPanel";
import { useNewArrivals } from "./useNewArrivals";
import { useOrderBroadcast } from "./useOrderBroadcast";
import { useOrderNotifications } from "./useOrderNotifications";

/**
 * Order half of the GNB's notification bells — split out from the
 * guest-request side (`RequestNotificationBell`) so each kind gets its own
 * badge count and panel instead of one combined total that mixes "a
 * request is waiting" with "a sale just happened". An order's "read" state
 * is client-only (`useOrderNotifications`'s `dismiss`, kept in
 * `localStorage`), not the server-owned status requests use, so there is
 * no mark-all action here. `playChime` comes from the one
 * `useNotificationSound()` instance `NotificationBells` owns.
 */
export function OrderNotificationBell({ playChime }: { playChime: () => void }) {
  const { t, i18n } = useTranslation("notifications");
  const router = useRouter();
  useOrderBroadcast();
  const { notifications, count, isLoading, dismiss } = useOrderNotifications();
  const arrivals = useNewArrivals(notifications, isLoading);

  // `t`, the active language, and `playChime` are read through this ref
  // rather than listed as this effect's dependencies — same reasoning as
  // `RequestNotificationBell`'s own ref: `playChime` is a fresh closure on
  // renders unrelated to a new arrival (e.g. the sound toggle), and
  // `arrivals` is "sticky" (see `useNewArrivals`), so resubscribing on
  // those renders would replay an already-shown toast/chime.
  const latestRef = useRef({ t, language: i18n.language, playChime });
  useEffect(() => {
    latestRef.current = { t, language: i18n.language, playChime };
  });

  useEffect(() => {
    if (arrivals.length === 0) {
      return;
    }
    const { t, language, playChime } = latestRef.current;
    for (const order of arrivals) {
      toast.add({
        title: t("newOrderToastTitle"),
        description: t("newOrderToastBody", {
          tableNumber: order.tableNumber,
          menuItemName: order.menuItemName,
          amount: formatCurrencyKRW(order.amount, language),
        }),
      });
    }
    playChime();
  }, [arrivals]);

  function handleItemClick(order: OrderNotification) {
    dismiss(order.id);
    router.push("/orders");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "relative")}
        aria-label={count > 0 ? t("orderBellLabel", { count }) : t("orderBellLabelEmpty")}
      >
        <RiShoppingCart2Line className="size-4" aria-hidden="true" />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-400 px-1 text-[10px] font-medium text-white"
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <OrderNotificationPanel notifications={notifications} onItemClick={handleItemClick} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
