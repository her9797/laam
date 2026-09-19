import type { PosTableSync, PosTableSyncStatus } from "./model";

/**
 * Pulling the table list out of the POS is a round trip through the POS
 * plugin: the server only queues a request, the plugin claims it, and the
 * result lands on `GET /admin/tables/pos-sync/{id}` some seconds later. So
 * the admin screen starts a sync and then polls it until it settles.
 */

/** Between 1 and 2 seconds, as the screen's spec calls for. */
export const POS_SYNC_POLL_INTERVAL_MS = 1500;

/**
 * The server flips a sync to `TIMED_OUT` itself once 30s pass, so the client
 * polls past that point and normally reports the server's verdict; giving up
 * on our own is only the fallback for a server that never does.
 */
export const POS_SYNC_MAX_POLLS = 30;

const TERMINAL_STATUSES = new Set<PosTableSyncStatus>(["DONE", "FAILED", "TIMED_OUT"]);

export function isTerminalPosSyncStatus(status: PosTableSyncStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type RunPosTableSyncDeps = {
  start: () => Promise<PosTableSync>;
  poll: (syncId: string) => Promise<PosTableSync>;
  wait: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxPolls?: number;
};

/**
 * Starts a sync and resolves with its final state. Never rejects on a failed
 * sync — a `FAILED`/`TIMED_OUT` status is a result the caller reports, not an
 * error; only a failing HTTP call rejects (through `start`/`poll`).
 */
export async function runPosTableSync({
  start,
  poll,
  wait,
  intervalMs = POS_SYNC_POLL_INTERVAL_MS,
  maxPolls = POS_SYNC_MAX_POLLS,
}: RunPosTableSyncDeps): Promise<PosTableSync> {
  let sync = await start();

  for (let attempt = 0; attempt < maxPolls && !isTerminalPosSyncStatus(sync.status); attempt += 1) {
    await wait(intervalMs);
    sync = await poll(sync.id);
  }

  if (!isTerminalPosSyncStatus(sync.status)) {
    return { ...sync, status: "TIMED_OUT" };
  }
  return sync;
}
