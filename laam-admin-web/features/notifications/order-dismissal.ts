/**
 * `localStorage` key for order ids the operator has already dismissed from
 * the "새 주문 알림" panel. Follows this app's existing `lam-admin.<feature>`
 * convention (`lam-admin.notifications.muted`).
 *
 * `payment_orders` has no server-side read state (see
 * `useOrderNotifications`'s doc comment), so "처리됨" for an order is a
 * genuinely per-device concept here, same reasoning as the mute
 * preference — it lives in `localStorage`, not behind an API call.
 */
const DISMISSED_ORDER_IDS_STORAGE_KEY = "lam-admin.notifications.dismissedOrderIds";

export function readDismissedOrderIds(): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }
  try {
    const raw = window.localStorage.getItem(DISMISSED_ORDER_IDS_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function writeDismissedOrderIds(ids: Set<string>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(DISMISSED_ORDER_IDS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage can throw (private browsing, disabled storage, quota). The
    // dismissal still works for the current session via React state; it
    // just won't be remembered next visit — same trade-off as the mute
    // preference in `useNotificationSound`.
  }
}
