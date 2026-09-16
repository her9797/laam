import { useEffect, useRef, useState } from "react";

/**
 * Detects items that appeared since the last time `items` was seen, for
 * the arrival toast and the alarm sound (`useNotificationSound`) — both
 * fire on the exact same event, so this is the one place that event is
 * computed, not duplicated per consumer. It is generic over anything with
 * a stable `id` because both alarm sources — pending customer requests
 * (`useNewRequestArrivals`) and completed sales
 * (`useOrderNotifications`) — need identical arrival semantics while
 * sharing no data shape.
 *
 * The confirmed requirement's "baseline" rule lives here: the first
 * successful load seeds the seen-id set without reporting anything (an
 * admin opening the app for the first time shouldn't get a toast/sound
 * burst for everything already on screen). Only items that appear *after*
 * that baseline are arrivals. IDs that later disappear (checked,
 * completed, deleted, or aged out of the queried window) are pruned from
 * the seen set rather than left to accumulate — see
 * `docs/plans/2026-09-04-admin-request-notifications.md`.
 *
 * The returned array's identity only changes when there is something new
 * to report — an unrelated re-render with the same `items` content does
 * not produce a new reference, so a consumer's
 * `useEffect(() => {...}, [arrivals])` fires exactly once per real
 * arrival, never on every render.
 *
 * `isLoading` gates when the baseline is allowed to seed. Before the
 * underlying query resolves for the first time, `items` is an empty
 * placeholder — that placeholder must never itself become the baseline, or
 * everything in the real first response gets misreported as a brand-new
 * arrival the instant it loads (caught via the Playwright e2e suite, not
 * the mocked unit tests, which never exercise a real loading→loaded
 * transition). Seeding only starts once `isLoading` has gone false, using
 * whatever `items` holds at that point — which by then is the real first
 * page of data.
 */
export function useNewArrivals<T extends { id: string }>(items: T[], isLoading: boolean): T[] {
  const [arrivals, setArrivals] = useState<T[]>([]);
  const seenIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const currentIds = new Set(items.map((item) => item.id));

    if (seenIdsRef.current === null) {
      seenIdsRef.current = currentIds;
      return;
    }

    const seenIds = seenIdsRef.current;
    const newOnes = items.filter((item) => !seenIds.has(item.id));
    seenIdsRef.current = currentIds;

    if (newOnes.length > 0) {
      setArrivals(newOnes);
    }
  }, [items, isLoading]);

  return arrivals;
}
