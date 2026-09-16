import { afterEach, describe, expect, it } from "vitest";

import { requestFailedMessage } from "@/i18n/messages";

import { formatDateTime, resolveDateTimeLocale } from "./utils";

const ISO = "2026-09-03T10:00:00Z";

afterEach(() => {
  document.documentElement.lang = "ko";
});

describe("resolveDateTimeLocale", () => {
  it("maps any English tag onto en-US", () => {
    expect(resolveDateTimeLocale("en")).toBe("en-US");
    expect(resolveDateTimeLocale("en-GB")).toBe("en-US");
    expect(resolveDateTimeLocale("EN")).toBe("en-US");
  });

  it("falls back to ko-KR for Korean, an unknown tag, or nothing at all", () => {
    expect(resolveDateTimeLocale("ko")).toBe("ko-KR");
    expect(resolveDateTimeLocale("ko-KR")).toBe("ko-KR");
    expect(resolveDateTimeLocale("fr")).toBe("ko-KR");
    expect(resolveDateTimeLocale(undefined)).toBe("ko-KR");
  });
});

describe("formatDateTime", () => {
  it("formats in Korean by default", () => {
    expect(formatDateTime(ISO)).toBe(formatDateTime(ISO, "ko"));
  });

  it("formats differently for English than for Korean", () => {
    expect(formatDateTime(ISO, "en")).not.toBe(formatDateTime(ISO, "ko"));
  });

  it("returns the raw value unchanged when it isn't a parseable date", () => {
    expect(formatDateTime("not a date", "en")).toBe("not a date");
  });
});

describe("requestFailedMessage", () => {
  it("interpolates the status and reads Korean from <html lang>", () => {
    document.documentElement.lang = "ko";
    expect(requestFailedMessage(500)).toBe("요청이 실패했습니다. (500)");
  });

  it("switches to English when the document language is English", () => {
    document.documentElement.lang = "en";
    expect(requestFailedMessage(404)).toBe("The request failed. (404)");
  });

  it("falls back to Korean for any other document language", () => {
    document.documentElement.lang = "fr";
    expect(requestFailedMessage(502)).toBe("요청이 실패했습니다. (502)");
  });
});
