import { describe, expect, it } from "vitest";

import {
  createAdminSessionValue,
  isAdminSessionValid,
  timingSafeEqualString,
} from "./session";

describe("admin session", () => {
  it("accepts a freshly created session value", () => {
    const now = new Date("2026-09-03T00:00:00.000Z");
    const value = createAdminSessionValue(now);

    expect(isAdminSessionValid(value, now)).toBe(true);
  });

  it("rejects a tampered session value", () => {
    const now = new Date("2026-09-03T00:00:00.000Z");
    const value = createAdminSessionValue(now);

    expect(isAdminSessionValid(`${value}tampered`, now)).toBe(false);
  });

  it("rejects an expired session value", () => {
    const now = new Date("2026-09-03T00:00:00.000Z");
    const value = createAdminSessionValue(now);

    expect(
      isAdminSessionValid(
        value,
        new Date(now.getTime() + 12 * 60 * 60 * 1000 + 1),
      ),
    ).toBe(false);
  });

  it("rejects a missing session value", () => {
    expect(isAdminSessionValid(undefined)).toBe(false);
  });

  it("rejects a malformed session value", () => {
    expect(isAdminSessionValid("not-a-valid-session")).toBe(false);
  });
});

describe("timingSafeEqualString", () => {
  it("accepts two identical strings", () => {
    expect(timingSafeEqualString("correct-password", "correct-password")).toBe(
      true,
    );
  });

  it("rejects a same-length string that differs only in the last byte", () => {
    expect(timingSafeEqualString("correct-password", "correct-passworD")).toBe(
      false,
    );
  });

  it("rejects strings of different lengths without throwing", () => {
    expect(timingSafeEqualString("correct-password", "short")).toBe(false);
  });

  it("rejects an empty string against a non-empty secret", () => {
    expect(timingSafeEqualString("", "correct-password")).toBe(false);
  });
});
