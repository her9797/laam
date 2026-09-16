import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Lazily creates (and memoizes) the browser-side Supabase client used only
 * for subscribing to the Realtime Broadcast signal
 * (`features/notifications/useRequestBroadcast.ts`) — never for querying
 * project tables directly; all data still goes through the BFF, per
 * `docs/plans/2026-09-04-admin-request-notifications.md` section 4.2/5.2.
 *
 * Returns `null` when either env var is unset, mirroring
 * `laam-api`'s `internal/notify.Broadcaster` "disabled" behavior — local
 * development without a Supabase project must keep working.
 */
let cachedClient: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  cachedClient = url && anonKey ? createClient(url, anonKey) : null;
  return cachedClient;
}
