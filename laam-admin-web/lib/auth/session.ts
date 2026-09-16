import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_VERSION = "v1";
const ADMIN_COOKIE_NAME = "lam_admin_session";
const ADMIN_MAX_AGE_SECONDS = 60 * 60 * 12;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET 환경변수가 설정되어 있지 않습니다.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
}

export function createAdminSessionValue(now: Date = new Date()): string {
  const expiresAtMs = now.getTime() + ADMIN_MAX_AGE_SECONDS * 1000;
  const payload = `${SESSION_VERSION}.admin.${expiresAtMs}`;
  return `${payload}.${sign(payload)}`;
}

export function isAdminSessionValid(
  value: string | undefined,
  now: Date = new Date(),
): boolean {
  if (!value) {
    return false;
  }

  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const [version, kind, expiresAtRaw, signature] = parts;
  if (version !== SESSION_VERSION || kind !== "admin") {
    return false;
  }

  const expiresAtMs = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
    return false;
  }

  if (!/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }

  const payload = `${version}.${kind}.${expiresAtRaw}`;
  const expectedSignature = sign(payload);
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  try {
    return timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison for two secret strings (e.g. a submitted password
 * against the configured admin password). Plain `===`/`!==` on strings
 * short-circuits on the first differing byte, leaking timing information
 * about the secret. `timingSafeEqual` itself requires equal-length buffers
 * and throws otherwise, which would reintroduce a (smaller) length-based
 * side channel if we simply padded/checked length first — instead we HMAC
 * both inputs with a fixed key first so the comparison is always over two
 * fixed-length (32-byte) digests, regardless of the original strings' length.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const key = getSessionSecret();
  const digestA = createHmac("sha256", key).update(a).digest();
  const digestB = createHmac("sha256", key).update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

export function getAdminCookieName(): string {
  return ADMIN_COOKIE_NAME;
}

export function getAdminCookieMaxAgeSeconds(): number {
  return ADMIN_MAX_AGE_SECONDS;
}
