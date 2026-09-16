import { beforeEach, describe, expect, it } from "vitest";

import {
  GLOBAL_BLOCK_MS,
  GLOBAL_MAX_FAILURES,
  IP_BASE_BLOCK_MS,
  IP_MAX_BLOCK_MS,
  IP_MAX_FAILURES,
  IP_WINDOW_MS,
  MAX_TRACKED_IPS,
  checkLoginAllowed,
  getClientIp,
  getTrackedIpCountForTests,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginRateLimitForTests,
} from "./login-rate-limit";

const START = 1_000_000_000_000;
const MINUTE = 60_000;

function failTimes(ip: string, times: number, now: number) {
  for (let i = 0; i < times; i += 1) {
    recordLoginFailure(ip, now);
  }
}

describe("getClientIp", () => {
  it("uses the rightmost X-Forwarded-For value appended by Cloud Run", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.1.1.1, 203.0.113.7",
    });

    expect(getClientIp(headers)).toBe("203.0.113.7");
  });

  it("ignores spoofed left-hand values so they cannot pick a fresh key", () => {
    const first = getClientIp(
      new Headers({ "x-forwarded-for": "9.9.9.1, 203.0.113.7" }),
    );
    const second = getClientIp(
      new Headers({ "x-forwarded-for": "9.9.9.2,203.0.113.7 " }),
    );

    expect(first).toBe("203.0.113.7");
    expect(second).toBe("203.0.113.7");
  });

  it("falls back to a single shared key when the header is missing", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
    expect(getClientIp(new Headers({ "x-forwarded-for": " , " }))).toBe(
      "unknown",
    );
  });
});

describe("login rate limit", () => {
  beforeEach(() => {
    resetLoginRateLimitForTests();
  });

  it("allows attempts until the per-IP failure limit is reached, then blocks", () => {
    failTimes("a", IP_MAX_FAILURES - 1, START);
    expect(checkLoginAllowed("a", START)).toEqual({ allowed: true });

    recordLoginFailure("a", START);

    expect(checkLoginAllowed("a", START)).toEqual({
      allowed: false,
      retryAfterSeconds: IP_BASE_BLOCK_MS / 1000,
    });
  });

  it("does not affect other IPs", () => {
    failTimes("a", IP_MAX_FAILURES, START);

    expect(checkLoginAllowed("b", START)).toEqual({ allowed: true });
  });

  it("lifts the block once the block duration has passed", () => {
    failTimes("a", IP_MAX_FAILURES, START);

    expect(checkLoginAllowed("a", START + IP_BASE_BLOCK_MS - 1).allowed).toBe(
      false,
    );
    expect(checkLoginAllowed("a", START + IP_BASE_BLOCK_MS)).toEqual({
      allowed: true,
    });
  });

  it("forgets failures older than the window", () => {
    failTimes("a", IP_MAX_FAILURES - 1, START);

    const later = START + IP_WINDOW_MS;
    recordLoginFailure("a", later);

    expect(checkLoginAllowed("a", later)).toEqual({ allowed: true });
  });

  it("doubles the block for each consecutive lockout up to the cap", () => {
    let now = START;
    const observed: number[] = [];

    for (let round = 0; round < 8; round += 1) {
      failTimes("a", IP_MAX_FAILURES, now);
      const result = checkLoginAllowed("a", now);
      if (result.allowed) {
        throw new Error("expected a block");
      }
      observed.push(result.retryAfterSeconds);
      now += result.retryAfterSeconds * 1000;
    }

    expect(observed).toEqual([60, 120, 240, 480, 960, 1800, 1800, 1800]);
    expect(IP_MAX_BLOCK_MS).toBe(1800 * 1000);
  });

  it("resets the IP's history after a successful login", () => {
    failTimes("a", IP_MAX_FAILURES, START);
    const afterBlock = START + IP_BASE_BLOCK_MS;
    failTimes("a", IP_MAX_FAILURES - 1, afterBlock);

    recordLoginSuccess("a", afterBlock);

    // Back to a clean slate: a full set of failures is allowed again and the
    // next lockout starts from the base duration, not the escalated one.
    failTimes("a", IP_MAX_FAILURES - 1, afterBlock);
    expect(checkLoginAllowed("a", afterBlock)).toEqual({ allowed: true });
    recordLoginFailure("a", afterBlock);
    expect(checkLoginAllowed("a", afterBlock)).toEqual({
      allowed: false,
      retryAfterSeconds: IP_BASE_BLOCK_MS / 1000,
    });
  });

  it("applies a short global block when failures across all IPs hit the cap", () => {
    for (let i = 0; i < GLOBAL_MAX_FAILURES; i += 1) {
      recordLoginFailure(`10.0.${Math.floor(i / 250)}.${i % 250}`, START);
    }

    expect(checkLoginAllowed("fresh-admin-ip", START)).toEqual({
      allowed: false,
      retryAfterSeconds: GLOBAL_BLOCK_MS / 1000,
    });
    // The global block is short so the real admin is only briefly delayed.
    expect(
      checkLoginAllowed("fresh-admin-ip", START + GLOBAL_BLOCK_MS),
    ).toEqual({ allowed: true });
  });

  it("drops quiet entries so the tracked IP map does not grow forever", () => {
    // Behavioural proxy for the sweep: an IP that has been quiet for longer
    // than the window after its last block starts again from the base block.
    failTimes("a", IP_MAX_FAILURES, START);
    const quiet = START + IP_BASE_BLOCK_MS + IP_WINDOW_MS;

    failTimes("a", IP_MAX_FAILURES, quiet);

    expect(checkLoginAllowed("a", quiet)).toEqual({
      allowed: false,
      retryAfterSeconds: IP_BASE_BLOCK_MS / 1000,
    });
  });

  it("sweeps expired entries and never tracks more than the cap", () => {
    failTimes("a", 1, START);
    expect(getTrackedIpCountForTests()).toBe(1);

    // Well past the window with no block: "a" is stale and gets swept on the
    // next request.
    checkLoginAllowed("b", START + IP_WINDOW_MS + 1);
    expect(getTrackedIpCountForTests()).toBe(0);

    const later = START + 10 * IP_WINDOW_MS;
    for (let i = 0; i < MAX_TRACKED_IPS + 50; i += 1) {
      recordLoginFailure(`ip-${i}`, later);
    }
    expect(getTrackedIpCountForTests()).toBeLessThanOrEqual(MAX_TRACKED_IPS);
  });
});
