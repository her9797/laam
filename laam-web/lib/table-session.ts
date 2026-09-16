"use client";

const TABLE_SESSION_KEY = "lam_table_number";

export function normalizeTableNumber(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 20);
}

export function getStoredTableNumber() {
  if (typeof window === "undefined") {
    return "";
  }

  return normalizeTableNumber(window.localStorage.getItem(TABLE_SESSION_KEY) ?? "");
}

export function setStoredTableNumber(value: string) {
  if (typeof window === "undefined") {
    return "";
  }

  const normalized = normalizeTableNumber(value);
  if (!normalized) {
    window.localStorage.removeItem(TABLE_SESSION_KEY);
    return "";
  }

  window.localStorage.setItem(TABLE_SESSION_KEY, normalized);
  return normalized;
}
