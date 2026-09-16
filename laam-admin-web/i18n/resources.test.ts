import { describe, expect, it } from "vitest";

import { en, ko } from "./resources";

const NAMESPACES = Object.keys(ko) as Array<keyof typeof ko>;

describe("i18n resources", () => {
  it("keeps the same top-level namespaces for both locales", () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
  });

  it("covers every feature namespace, not just the app shell", () => {
    expect(NAMESPACES.sort()).toEqual(
      [
        "auth",
        "common",
        "dashboard",
        "menu",
        "notices",
        "notifications",
        "orders",
        "player",
        "requests",
        "specialRequests",
        "storeCopy",
        "systemLogs",
        "tables",
      ].sort(),
    );
  });

  it.each(NAMESPACES)("keeps Korean and English keys in sync for the %s namespace", (namespace) => {
    expect(Object.keys(ko[namespace]).sort()).toEqual(Object.keys(en[namespace]).sort());
  });

  it.each(NAMESPACES)("has non-empty string values for every %s key", (namespace) => {
    for (const resource of [ko[namespace], en[namespace]] as Array<Record<string, unknown>>) {
      for (const [key, value] of Object.entries(resource)) {
        expect(typeof value, `${namespace}.${key}`).toBe("string");
        expect((value as string).length, `${namespace}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps interpolation placeholders identical across locales", () => {
    for (const namespace of NAMESPACES) {
      const koResource = ko[namespace] as Record<string, string>;
      const enResource = en[namespace] as Record<string, string>;
      for (const key of Object.keys(koResource)) {
        const placeholders = (value: string) => (value.match(/{{\s*\w+\s*}}/g) ?? []).sort();
        expect(placeholders(enResource[key]), `${namespace}.${key}`).toEqual(
          placeholders(koResource[key]),
        );
      }
    }
  });

  it("has no Hangul left in the English resources", () => {
    for (const namespace of NAMESPACES) {
      for (const [key, value] of Object.entries(en[namespace] as Record<string, string>)) {
        expect(/[가-힣]/.test(value), `${namespace}.${key} is still Korean`).toBe(false);
      }
    }
  });
});
