import { createHmac, timingSafeEqual } from "node:crypto";

type SessionKind = "qr" | "staff";

const SESSION_VERSION = "v1";
const QR_COOKIE = "lam_qr_session";
const STAFF_COOKIE = "lam_staff_session";
const QR_MAX_AGE_SECONDS = 60 * 60 * 8;

function getSessionSecret() {
  return process.env.SESSION_SECRET ?? "lam-dev-session-secret";
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("hex");
}

function createSessionValue(kind: SessionKind, maxAgeSeconds: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const payload = `${SESSION_VERSION}.${kind}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionValue(value: string | undefined, expectedKind: SessionKind) {
  if (!value) {
    return false;
  }

  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const [version, kind, expiresAtRaw, signature] = parts;
  if (version !== SESSION_VERSION || kind !== expectedKind) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const payload = `${version}.${kind}.${expiresAtRaw}`;
  const expectedSignature = sign(payload);

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

export function createQrSessionValue() {
  return createSessionValue("qr", QR_MAX_AGE_SECONDS);
}

export function createStaffSessionValue() {
  return createSessionValue("staff", QR_MAX_AGE_SECONDS);
}

export function isQrSessionValid(value: string | undefined) {
  return verifySessionValue(value, "qr");
}

export function isStaffSessionValid(value: string | undefined) {
  return verifySessionValue(value, "staff");
}

export function getQrCookieName() {
  return QR_COOKIE;
}

export function getStaffCookieName() {
  return STAFF_COOKIE;
}

export function getStaffEntryToken() {
  return process.env.STAFF_ENTRY_TOKEN ?? "";
}

export function getQrAccessToken() {
  return process.env.QR_ACCESS_TOKEN ?? "lam-qr-entry";
}

function getQrSigningSecret() {
  return process.env.QR_SIGNING_SECRET ?? "";
}

export function createQrTableSignature(table: string) {
  const secret = getQrSigningSecret();
  if (!secret) {
    return "";
  }

  return createHmac("sha256", secret).update(table).digest("hex");
}

export function isQrTableSignatureValid(table: string, signature: string | null) {
  if (!signature) {
    return false;
  }

  const expectedSignature = createQrTableSignature(table);
  if (!expectedSignature) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

export function getQrCookieMaxAge() {
  return QR_MAX_AGE_SECONDS;
}
