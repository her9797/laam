"use client";

import "@/i18n/client";

import { RiVolumeMuteLine, RiVolumeUpLine } from "@remixicon/react";
import { useTranslation } from "react-i18next";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { UseNotificationSoundResult } from "./useNotificationSound";

/**
 * Device-wide mute/unblock control for both notification bells'
 * (`RequestNotificationBell`, `OrderNotificationBell`) arrival chime.
 * Deliberately a single shared control rather than one per bell: muting is
 * one preference for "does this browser beep", not two — see
 * `NotificationBells`, the only place that owns the single
 * `useNotificationSound()` instance this reads.
 */
export function NotificationSoundToggle({ sound }: { sound: UseNotificationSoundResult }) {
  const { t } = useTranslation("notifications");

  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}
      aria-label={
        sound.isBlocked
          ? t("soundBlockedLabel")
          : sound.isMuted
            ? t("soundUnmuteLabel")
            : t("soundMuteLabel")
      }
      onClick={sound.isBlocked ? sound.enableSound : sound.toggleMuted}
    >
      {sound.isBlocked || sound.isMuted ? (
        <RiVolumeMuteLine className="size-4" aria-hidden="true" />
      ) : (
        <RiVolumeUpLine className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
