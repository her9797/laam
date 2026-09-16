/**
 * In-memory failed-login limiter for `POST /api/auth/admin-login`.
 *
 * Server-only: imported solely by the admin-login route handler. (The
 * `server-only` npm package is not a dependency of this app, so the marker
 * import is intentionally absent rather than adding a dependency.)
 *
 * Why process memory is enough here: the admin web runs on Cloud Run with
 * `--max-instances=1` (see `scripts/deploy-cloud-run.sh`), so every login
 * request reaches the same process. Known limits:
 * - State is lost when the instance restarts or is replaced (deploy, idle
 *   scale-to-zero), which resets every counter and block.
 * - If `--max-instances` is ever raised, each instance keeps its own counters,
 *   so the effective limits multiply by the instance count. Move this state to
 *   a shared store before scaling out.
 *
 * Only failed attempts are counted; a blocked (429) request never reaches the
 * password comparison and is not counted again.
 */

const MINUTE_MS = 60_000;

/**
 * 5 failures per 15 minutes per IP: a real operator mistyping the single
 * shared password rarely needs more than a few tries, while an online guesser
 * is held to a handful of guesses per window before blocks start escalating.
 */
export const IP_MAX_FAILURES = 5;
export const IP_WINDOW_MS = 15 * MINUTE_MS;

/**
 * Each consecutive lockout doubles the block (1, 2, 4, 8, 16 minutes, then
 * capped at 30). Short first block so a fumbling operator is barely slowed;
 * the 30-minute cap bounds how long a legitimate operator sharing an IP with
 * an attacker (e.g. the same office NAT) can be locked out.
 */
export const IP_BASE_BLOCK_MS = 1 * MINUTE_MS;
export const IP_MAX_BLOCK_MS = 30 * MINUTE_MS;

/**
 * Global cap against guessing spread over many IPs: 100 failures per 15
 * minutes across all clients is far above anything one store's staff
 * produces. Once exceeded, every client (including the real operator) is
 * blocked for only 1 minute at a time, and each further failure inside the
 * same window re-arms that 1-minute block. That keeps a distributed attack to
 * roughly one guess per minute after the cap without locking the operator out
 * for long.
 */
export const GLOBAL_MAX_FAILURES = 100;
export const GLOBAL_WINDOW_MS = 15 * MINUTE_MS;
export const GLOBAL_BLOCK_MS = 1 * MINUTE_MS;

/**
 * Memory bound for tracked IPs. Quiet entries are swept lazily; if the map is
 * still full the oldest entry is evicted. Reaching this many live entries
 * needs thousands of distinct real client IPs, by which point the global cap
 * has long been engaged.
 */
export const MAX_TRACKED_IPS = 10_000;
const SWEEP_INTERVAL_MS = 1 * MINUTE_MS;

const UNKNOWN_CLIENT_KEY = "unknown";

type IpEntry = {
  windowStartAt: number;
  failures: number;
  lastFailureAt: number;
  blockedUntil: number;
  /** Number of lockouts so far; drives the exponential block duration. */
  lockouts: number;
};

export type LoginAllowance =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

const ipEntries = new Map<string, IpEntry>();
let globalWindowStartAt = 0;
let globalFailures = 0;
let globalBlockedUntil = 0;
let lastSweepAt = 0;

/**
 * Cloud Run appends the address it actually saw to the end of
 * `X-Forwarded-For`; anything to its left was supplied by the client and can
 * be forged. Only the rightmost non-empty value is trusted. Without the header
 * (local dev, tests) every request shares one key.
 */
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return UNKNOWN_CLIENT_KEY;
  }
  const values = forwardedFor
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.at(-1) ?? UNKNOWN_CLIENT_KEY;
}

function isStale(entry: IpEntry, now: number): boolean {
  // Forget an IP once it is unblocked and has been quiet for a full window
  // since its last failure or block, whichever ended later.
  return (
    now >= entry.blockedUntil &&
    now - Math.max(entry.lastFailureAt, entry.blockedUntil) >= IP_WINDOW_MS
  );
}

function sweep(now: number) {
  lastSweepAt = now;
  for (const [ip, entry] of ipEntries) {
    if (isStale(entry, now)) {
      ipEntries.delete(ip);
    }
  }
}

function maybeSweep(now: number) {
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) {
    sweep(now);
  }
}

function toRetryAfterSeconds(untilMs: number, now: number): number {
  return Math.max(1, Math.ceil((untilMs - now) / 1000));
}

export function checkLoginAllowed(
  ip: string,
  now: number = Date.now(),
): LoginAllowance {
  maybeSweep(now);

  let blockedUntil = globalBlockedUntil;
  const entry = ipEntries.get(ip);
  if (entry && !isStale(entry, now)) {
    blockedUntil = Math.max(blockedUntil, entry.blockedUntil);
  }

  if (now < blockedUntil) {
    return {
      allowed: false,
      retryAfterSeconds: toRetryAfterSeconds(blockedUntil, now),
    };
  }
  return { allowed: true };
}

export function recordLoginFailure(ip: string, now: number = Date.now()) {
  maybeSweep(now);

  if (now - globalWindowStartAt >= GLOBAL_WINDOW_MS) {
    globalWindowStartAt = now;
    globalFailures = 0;
  }
  globalFailures += 1;
  if (globalFailures >= GLOBAL_MAX_FAILURES) {
    globalBlockedUntil = now + GLOBAL_BLOCK_MS;
  }

  let entry = ipEntries.get(ip);
  if (entry && isStale(entry, now)) {
    ipEntries.delete(ip);
    entry = undefined;
  }
  if (!entry) {
    if (ipEntries.size >= MAX_TRACKED_IPS) {
      sweep(now);
    }
    if (ipEntries.size >= MAX_TRACKED_IPS) {
      const oldestIp = ipEntries.keys().next().value;
      if (oldestIp !== undefined) {
        ipEntries.delete(oldestIp);
      }
    }
    entry = {
      windowStartAt: now,
      failures: 0,
      lastFailureAt: now,
      blockedUntil: 0,
      lockouts: 0,
    };
    ipEntries.set(ip, entry);
  }

  if (now - entry.windowStartAt >= IP_WINDOW_MS) {
    entry.windowStartAt = now;
    entry.failures = 0;
  }
  entry.failures += 1;
  entry.lastFailureAt = now;

  if (entry.failures >= IP_MAX_FAILURES) {
    const blockMs = Math.min(
      IP_BASE_BLOCK_MS * 2 ** entry.lockouts,
      IP_MAX_BLOCK_MS,
    );
    entry.blockedUntil = now + blockMs;
    entry.lockouts += 1;
    entry.failures = 0;
    entry.windowStartAt = now;
  }
}

/**
 * A correct password clears that IP's history. The global counter is left
 * alone: one successful login says nothing about guessing from other IPs.
 */
export function recordLoginSuccess(ip: string, now: number = Date.now()) {
  maybeSweep(now);
  ipEntries.delete(ip);
}

/** Test-only. Never call from production code paths. */
export function resetLoginRateLimitForTests() {
  ipEntries.clear();
  globalWindowStartAt = 0;
  globalFailures = 0;
  globalBlockedUntil = 0;
  lastSweepAt = 0;
}

/** Test-only. Never call from production code paths. */
export function getTrackedIpCountForTests(): number {
  return ipEntries.size;
}
