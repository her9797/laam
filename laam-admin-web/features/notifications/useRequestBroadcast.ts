import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { requestsKeys } from "@/features/requests/queries";
import { getSupabaseClient } from "@/lib/supabase/client";

import { BROADCAST_REFETCH_INTERVAL_MS, createBroadcastThrottle } from "./broadcast-throttle";

/**
 * Topic/event names for the Realtime Broadcast signal sent after a
 * customer request is created. Must match `laam-api`'s
 * `internal/notify.RequestsTopic` / `NewRequestEvent` exactly — there is no
 * shared source of truth across the Go and TypeScript codebases, so a
 * rename on either side breaks this silently until checked manually.
 */
const REQUESTS_TOPIC = "admin-requests";
const NEW_REQUEST_EVENT = "new_request";

/**
 * Subscribes to the public `admin-requests` Broadcast channel and
 * invalidates `requestsKeys.all` on `new_request` signals, so the
 * notification bell and dashboard refetch immediately instead of waiting
 * for the 60s safety-net poll (`features/requests/queries.ts`) — see
 * `docs/plans/2026-09-04-admin-request-notifications.md` sections 3-4.3.
 *
 * Signals go through `createBroadcastThrottle`: the first one after a quiet
 * `BROADCAST_REFETCH_INTERVAL_MS` still refetches immediately, but any more
 * inside that interval fold into one trailing refetch — the channel is
 * joined with the public anon key, so a flood of forged signals must not
 * turn into a flood of BFF refetches.
 *
 * The signal carries no request data (public, content-free channel, per
 * section 4.2) — the callback only triggers a refetch through the existing
 * BFF-backed query, it never reads the broadcast payload itself.
 *
 * A no-op when Supabase isn't configured (`getSupabaseClient()` returns
 * `null`), matching `laam-api`'s send-side "disabled" behavior so local
 * development without a Supabase project keeps working — the 60s poll
 * alone still delivers the notification, just slower.
 */
export function useRequestBroadcast(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    const throttle = createBroadcastThrottle(() => {
      queryClient.invalidateQueries({ queryKey: requestsKeys.all });
    }, BROADCAST_REFETCH_INTERVAL_MS);

    const channel = supabase.channel(REQUESTS_TOPIC);
    channel
      .on("broadcast", { event: NEW_REQUEST_EVENT }, () => {
        throttle.call();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      throttle.dispose();
    };
  }, [queryClient]);
}
