import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { orderKeys } from "@/features/orders/queries";
import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Topic/event names for the Realtime Broadcast signal sent after a payment
 * order is completed. Must match `laam-api`'s `internal/notify.OrdersTopic`
 * / `NewOrderEvent` exactly — as with `useRequestBroadcast`, there is no
 * shared source of truth across the Go and TypeScript codebases, so a
 * rename on either side breaks this silently until checked manually.
 */
const ORDERS_TOPIC = "admin-orders";
const NEW_ORDER_EVENT = "new_order";

/**
 * Subscribes to the public `admin-orders` Broadcast channel and
 * invalidates `orderKeys.all` on every `new_order` signal, so a sale that
 * completes while the operator is looking at the order list (or anywhere
 * else in the admin web) shows up without a manual refresh.
 *
 * Deliberately a separate hook and channel from `useRequestBroadcast`
 * rather than another event on `admin-requests`: customer requests and
 * payment orders are separate flows with separate caches, and neither
 * should invalidate the other's.
 *
 * The signal carries no order data — the callback only triggers a refetch
 * through the existing BFF-backed queries, it never reads the broadcast
 * payload itself. That matters more here than for requests: order rows
 * carry payment details, and this channel is public.
 *
 * A no-op when Supabase isn't configured (`getSupabaseClient()` returns
 * `null`), matching `laam-api`'s send-side "disabled" behavior — local
 * development without a Supabase project keeps working, just at the pace
 * of the notification query's own safety-net poll.
 */
export function useOrderBroadcast(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    const channel = supabase.channel(ORDERS_TOPIC);
    channel
      .on("broadcast", { event: NEW_ORDER_EVENT }, () => {
        queryClient.invalidateQueries({ queryKey: orderKeys.all });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
