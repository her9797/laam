"use client";

import "@/i18n/client";

import { RiNotification3Line } from "@remixicon/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import {
  useUpdateCustomerRequestStatusesMutation,
  useUpdateCustomerRequestStatusMutation,
} from "@/features/requests/queries";
import { cn } from "@/lib/utils";

import type { RequestNotification, RequestNotificationKind } from "./model";
import { RequestNotificationPanel } from "./RequestNotificationPanel";
import { useNewRequestArrivals } from "./useNewRequestArrivals";
import { useRequestBroadcast } from "./useRequestBroadcast";
import { useRequestNotifications } from "./useRequestNotifications";

const KIND_HREF: Record<RequestNotificationKind, string> = {
  general: "/requests",
  song: "/song-requests",
};

/**
 * Guest-request half of the GNB's notification bells — split out from the
 * order side (`OrderNotificationBell`) so an operator who only cares about
 * one kind isn't forced to scan a combined badge/panel for the other. The
 * arrival chime is still a single shared device preference: `playChime`
 * comes from the one `useNotificationSound()` instance `NotificationBells`
 * owns, not from a hook call here.
 */
export function RequestNotificationBell({ playChime }: { playChime: () => void }) {
  const { t } = useTranslation("notifications");
  const router = useRouter();
  useRequestBroadcast();
  const { notifications, count, isLoading, isError } = useRequestNotifications();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const arrivals = useNewRequestArrivals(notifications, isLoading);

  const singleMutation = useUpdateCustomerRequestStatusMutation();
  const bulkMutation = useUpdateCustomerRequestStatusesMutation();
  const generalRequestCount = notifications.filter(
    (notification) => notification.kind === "general",
  ).length;

  // `t` and `playChime` are read through this ref rather than listed as
  // this effect's dependencies — same reasoning as the pre-split
  // `NotificationBell` had: `playChime` is a fresh closure on renders that
  // have nothing to do with a new arrival (e.g. the sound toggle flipping
  // in the sibling bell), and `arrivals` is "sticky" (see
  // `useNewRequestArrivals`), so resubscribing on those renders would
  // replay an already-shown toast/chime.
  const latestRef = useRef({ t, playChime });
  useEffect(() => {
    latestRef.current = { t, playChime };
  });

  useEffect(() => {
    if (arrivals.length === 0) {
      return;
    }
    const { t, playChime } = latestRef.current;
    for (const notification of arrivals) {
      toast.add({
        title: t("newRequestToastTitle"),
        description: t(
          notification.kind === "song" ? "newRequestToastSong" : "newRequestToastGeneral",
          { tableNumber: notification.tableNumber, preview: notification.preview },
        ),
      });
    }
    // Chime once for the whole batch — several requests landing together
    // still means a single beep, not one per request.
    playChime();
  }, [arrivals]);

  function handleItemClick(notification: RequestNotification) {
    if (notification.kind === "general") {
      singleMutation.mutate({ id: notification.id, status: "checked" });
    }
    router.push(KIND_HREF[notification.kind]);
  }

  function handleConfirmMarkAll() {
    const generalRequestIDs = notifications
      .filter((notification) => notification.kind === "general")
      .map((notification) => notification.id);
    if (generalRequestIDs.length > 0) {
      bulkMutation.mutate({ ids: generalRequestIDs, status: "checked" });
    }
    setIsConfirmOpen(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "relative")}
          aria-label={count > 0 ? t("bellLabel", { count }) : t("bellLabelEmpty")}
        >
          <RiNotification3Line className="size-4" aria-hidden="true" />
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
          <RequestNotificationPanel
            notifications={notifications}
            isError={isError}
            isItemPending={(id) => singleMutation.isPending && singleMutation.variables?.id === id}
            onItemClick={handleItemClick}
            onMarkAllClick={() => setIsConfirmOpen(true)}
            isMarkAllPending={bulkMutation.isPending}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("markAllConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("markAllConfirmBody", { count: generalRequestCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmMarkAll}>
              {t("common:confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
