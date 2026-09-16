/**
 * Minimum gap between two refetches triggered by a Realtime Broadcast
 * signal (`useRequestBroadcast`, `useOrderBroadcast`).
 *
 * Both hooks join a public channel with the public anon key, so anyone
 * holding that key may be able to send `new_request`/`new_order` too, as
 * fast as Realtime lets them — whether they can is decided by the Supabase
 * project's Realtime settings, outside this repo. Without a floor, every
 * signed-in admin browser would refetch its BFF-backed lists once per forged
 * event, and because `invalidateQueries` cancels an in-flight refetch by
 * default (`cancelRefetch: true`), a fast enough flood would also keep the
 * bell's own refetch from ever finishing. This bound is the client's half
 * of the defense, not a replacement for rejecting those sends.
 *
 * 3s: comfortably longer than a BFF list round trip, so a coalesced refetch
 * normally completes before the next one may start, and a flood is capped
 * at one invalidation every 3s per channel, per browser. Short enough that
 * a genuine arrival folded into a burst is at most 3s late — far inside the
 * 60s safety-net poll (`features/requests/queries.ts`,
 * `features/orders/queries.ts`). The first signal after a quiet interval
 * isn't delayed at all (see `createBroadcastThrottle`).
 */
export const BROADCAST_REFETCH_INTERVAL_MS = 3_000;

export type BroadcastThrottle = {
  /** Runs `fn` now, or folds this call into the open interval's trailing run. */
  call: () => void;
  /** Drops a pending trailing run, clears its timer, and makes later calls no-ops. */
  dispose: () => void;
};

/**
 * Wraps `fn` so consecutive runs are always at least `intervalMs` apart,
 * without losing the last call:
 *
 * - Leading: a call while no interval is open runs `fn` immediately and
 *   opens one, so an isolated signal still refetches right away.
 * - Trailing: every call made while an interval is open collapses into a
 *   single run when it closes, and that run opens the next interval — a
 *   sustained flood settles into one run per `intervalMs`, and the latest
 *   signal is still reflected at most `intervalMs` later.
 *
 * `dispose` is permanent rather than a reset because a hook's cleanup can't
 * stop a signal that's already on its way: `supabase.removeChannel` only
 * tears the channel's bindings down once the server acknowledges the leave,
 * so a broadcast landing in between still runs the callback after unmount.
 * Without this guard that call would refetch and leave behind a timer
 * nothing clears.
 */
export function createBroadcastThrottle(fn: () => void, intervalMs: number): BroadcastThrottle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let disposed = false;

  // The interval opens before `fn` runs, so the bound still holds if `fn`
  // throws or calls back into `call`.
  function run() {
    timer = setTimeout(() => {
      timer = null;
      if (pending) {
        pending = false;
        run();
      }
    }, intervalMs);
    fn();
  }

  return {
    call() {
      if (disposed) {
        return;
      }
      if (timer !== null) {
        pending = true;
        return;
      }
      run();
    },
    dispose() {
      disposed = true;
      pending = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
