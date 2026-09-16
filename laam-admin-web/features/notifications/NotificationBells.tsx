"use client";

import { OrderNotificationBell } from "./OrderNotificationBell";
import { NotificationSoundToggle } from "./NotificationSoundToggle";
import { RequestNotificationBell } from "./RequestNotificationBell";
import { useNotificationSound } from "./useNotificationSound";

/**
 * GNB entry point for both notification bells. Owns the single
 * `useNotificationSound()` instance (one `AudioContext`, one mute
 * preference) and hands its `playChime` down to each bell — muting is one
 * device-wide preference, not two, so this is the only place that calls
 * the hook; `RequestNotificationBell`/`OrderNotificationBell` never call it
 * themselves.
 */
export function NotificationBells() {
  const sound = useNotificationSound();

  return (
    <>
      <NotificationSoundToggle sound={sound} />
      <RequestNotificationBell playChime={sound.playChime} />
      <OrderNotificationBell playChime={sound.playChime} />
    </>
  );
}
