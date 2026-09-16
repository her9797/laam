import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBroadcastThrottle } from "./broadcast-throttle";

const INTERVAL_MS = 1_000;

describe("createBroadcastThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately on the first call", () => {
    const fn = vi.fn();
    const throttle = createBroadcastThrottle(fn, INTERVAL_MS);

    throttle.call();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("folds every call inside the interval into one trailing run at the end of it", () => {
    const fn = vi.fn();
    const throttle = createBroadcastThrottle(fn, INTERVAL_MS);

    for (let i = 0; i < 50; i++) {
      throttle.call();
    }
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(INTERVAL_MS - 1);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(INTERVAL_MS * 10);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps at least the interval between runs while calls keep coming", () => {
    const runTimes: number[] = [];
    const throttle = createBroadcastThrottle(() => runTimes.push(Date.now()), INTERVAL_MS);

    // One call every 100ms for 10s — a sustained flood, not a single burst.
    for (let elapsed = 0; elapsed < 10_000; elapsed += 100) {
      throttle.call();
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(INTERVAL_MS * 10);

    expect(runTimes.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < runTimes.length; i++) {
      expect(runTimes[i] - runTimes[i - 1]).toBeGreaterThanOrEqual(INTERVAL_MS);
    }
  });

  it("runs immediately again once a full interval passes with nothing pending", () => {
    const fn = vi.fn();
    const throttle = createBroadcastThrottle(fn, INTERVAL_MS);

    throttle.call();
    vi.advanceTimersByTime(INTERVAL_MS);
    expect(fn).toHaveBeenCalledTimes(1);

    throttle.call();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("drops a pending trailing run and clears its timer on dispose", () => {
    const fn = vi.fn();
    const throttle = createBroadcastThrottle(fn, INTERVAL_MS);

    throttle.call();
    throttle.call();
    throttle.dispose();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(INTERVAL_MS * 10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ignores calls made after dispose", () => {
    const fn = vi.fn();
    const throttle = createBroadcastThrottle(fn, INTERVAL_MS);

    throttle.dispose();
    throttle.call();

    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
