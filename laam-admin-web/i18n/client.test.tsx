import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `i18n/client.ts` is a module singleton initialized once at import time
// (like production code importing it via a bare `import "@/i18n/client"`).
// To exercise a *fresh* "reload with a locale already in localStorage"
// bootstrap — the exact scenario the restored-locale bug lives in — each
// test resets the module registry and re-imports it dynamically instead of
// relying on a static top-level import.
describe("i18n client bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    document.documentElement.lang = "ko";
  });

  afterEach(() => {
    cleanup();
  });

  it("resolves document.documentElement.lang from a locale restored from localStorage", async () => {
    window.localStorage.setItem("lam-admin.locale", "en");

    await import("./client");

    // `i18next-browser-languagedetector` resolves synchronously during
    // `i18n.init()`, so the module-level assignment already reflects the
    // restored locale right after import.
    expect(document.documentElement.lang).toBe("en");
  });

  it("re-applies the resolved language after mount, surviving a hydration-style reset of <html lang>", async () => {
    window.localStorage.setItem("lam-admin.locale", "en");

    const { useSyncDocumentLanguage } = await import("./client");

    // Simulates what React's hydration does in the real app: `app/layout.tsx`
    // renders `<html lang="ko">`, and hydration reconciles the actual DOM
    // attribute back to that server-rendered prop, overwriting whatever the
    // module-level assignment above already set — this is the exact
    // regression that shipped with only the module-level assignment and the
    // reactive `languageChanged` listener (neither fires again for a locale
    // that was already the resolved language at init time).
    document.documentElement.lang = "ko";

    function Probe() {
      useSyncDocumentLanguage();
      return null;
    }

    render(<Probe />);

    expect(document.documentElement.lang).toBe("en");
  });
});
