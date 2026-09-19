import { describe, expect, it, vi } from "vitest";

import type { PosTableSync } from "./model";
import {
  POS_SYNC_MAX_POLLS,
  POS_SYNC_POLL_INTERVAL_MS,
  isTerminalPosSyncStatus,
  runPosTableSync,
} from "./pos-sync";

function buildSync(overrides: Partial<PosTableSync> = {}): PosTableSync {
  return {
    id: "sync-1",
    status: "PENDING",
    requestedAt: "2026-09-19T00:00:00Z",
    completedAt: null,
    linkedCount: 0,
    unlinkedCount: 0,
    posOnlyCount: 0,
    error: null,
    ...overrides,
  };
}

describe("isTerminalPosSyncStatus", () => {
  it("treats DONE, FAILED and TIMED_OUT as finished and PENDING/RUNNING as not", () => {
    expect(isTerminalPosSyncStatus("DONE")).toBe(true);
    expect(isTerminalPosSyncStatus("FAILED")).toBe(true);
    expect(isTerminalPosSyncStatus("TIMED_OUT")).toBe(true);
    expect(isTerminalPosSyncStatus("PENDING")).toBe(false);
    expect(isTerminalPosSyncStatus("RUNNING")).toBe(false);
  });
});

describe("runPosTableSync", () => {
  it("polls the sync it started until the plugin reports DONE", async () => {
    const start = vi.fn(async () => buildSync({ status: "PENDING" }));
    const poll = vi
      .fn<(syncId: string) => Promise<PosTableSync>>()
      .mockResolvedValueOnce(buildSync({ status: "RUNNING" }))
      .mockResolvedValueOnce(buildSync({ status: "DONE", linkedCount: 4, posOnlyCount: 1 }));
    const wait = vi.fn(async () => {});

    const result = await runPosTableSync({ start, poll, wait });

    expect(result).toMatchObject({ status: "DONE", linkedCount: 4, posOnlyCount: 1 });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(poll).toHaveBeenCalledWith("sync-1");
    // A poll never fires without first waiting out the interval.
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(POS_SYNC_POLL_INTERVAL_MS);
  });

  it("polls between one and two seconds apart", () => {
    expect(POS_SYNC_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
    expect(POS_SYNC_POLL_INTERVAL_MS).toBeLessThanOrEqual(2000);
  });

  it("does not poll at all when the sync comes back already finished", async () => {
    const start = vi.fn(async () => buildSync({ status: "DONE" }));
    const poll = vi.fn(async () => buildSync({ status: "DONE" }));
    const wait = vi.fn(async () => {});

    await expect(runPosTableSync({ start, poll, wait })).resolves.toMatchObject({ status: "DONE" });
    expect(poll).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });

  it("stops and reports the failure when the plugin reports FAILED", async () => {
    const start = vi.fn(async () => buildSync({ status: "RUNNING" }));
    const poll = vi.fn(async () => buildSync({ status: "FAILED", error: "plugin crashed" }));

    const result = await runPosTableSync({ start, poll, wait: async () => {} });

    expect(result).toMatchObject({ status: "FAILED", error: "plugin crashed" });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("returns the server's TIMED_OUT status without polling further", async () => {
    const start = vi.fn(async () => buildSync({ status: "PENDING" }));
    const poll = vi.fn(async () => buildSync({ status: "TIMED_OUT" }));

    const result = await runPosTableSync({ start, poll, wait: async () => {} });

    expect(result.status).toBe("TIMED_OUT");
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("gives up as TIMED_OUT when the sync never leaves RUNNING", async () => {
    const start = vi.fn(async () => buildSync({ status: "PENDING" }));
    const poll = vi.fn(async () => buildSync({ status: "RUNNING" }));

    const result = await runPosTableSync({ start, poll, wait: async () => {}, maxPolls: 3 });

    expect(result.status).toBe("TIMED_OUT");
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("polls long enough to outlast the server's own 30s timeout", () => {
    // `GET /admin/tables/pos-sync/{id}` flips a sync to TIMED_OUT itself
    // once 30s have passed; the client must still be polling by then, so
    // the operator sees the server's verdict rather than the client's.
    expect(POS_SYNC_MAX_POLLS * POS_SYNC_POLL_INTERVAL_MS).toBeGreaterThan(30_000);
  });
});
