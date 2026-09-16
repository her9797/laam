// @vitest-environment node
/**
 * Reproduces the real bug this fix addresses: `ThemeProvider` used to read
 * `localStorage`/`matchMedia` inside its `useState` lazy initializers, so a
 * previously stored "dark" preference made the client's first render
 * disagree with the server's ("system") render — the exact
 * `aria-label="테마: 다크"` vs `aria-label="테마: 시스템"` hydration warning
 * reported against `ThemeMenu` in production.
 *
 * `jsdom`-based component tests can't catch this: vitest's `jsdom`
 * environment makes `window` exist for every render in the file, so the
 * server-side branch (`typeof window === "undefined"`) never actually runs.
 * This file opts out of that environment (`@vitest-environment node`) so
 * `renderToString` genuinely has no `window`, then builds a `jsdom` document
 * by hand for the hydrate half — a real two-phase render, not a simulation.
 */
import { JSDOM } from "jsdom";
import { act, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/i18n/client";

import { ThemeMenu } from "./ThemeMenu";
import { ThemeProvider } from "./ThemeProvider";

function Tree(): ReactElement {
  return (
    <ThemeProvider>
      <ThemeMenu />
    </ThemeProvider>
  );
}

let installedGlobalKeys: string[] = [];

// Adds every own property of a fresh `jsdom` window onto `globalThis` that
// Node doesn't already have — not just `window`/`document`/`navigator`.
// Libraries this tree renders through (base-ui, floating-ui) feature-detect
// against bare globals like `HTMLElement`/`Node`/`MouseEvent`, which plain
// Node has no equivalent for. Restricted to keys Node lacks (rather than
// copying everything) so this can't clobber Node's own `Array`/`Object`/
// `Infinity`/etc. — several of which are non-writable and would otherwise
// throw mid-copy and leave `globalThis` half-patched.
function installJsdomGlobals(storedTheme: string | null) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/",
  });
  if (storedTheme) {
    dom.window.localStorage.setItem("lam-admin.theme", storedTheme);
  }
  dom.window.matchMedia = ((query: string) =>
    ({
      matches: true, // OS prefers dark — matches the `storedTheme: null` ("system") case below.
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;

  installedGlobalKeys = Object.getOwnPropertyNames(dom.window).filter((key) => !(key in globalThis));
  for (const key of installedGlobalKeys) {
    Object.defineProperty(globalThis, key, {
      value: (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }
  return dom;
}

function uninstallJsdomGlobals() {
  for (const key of installedGlobalKeys) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  installedGlobalKeys = [];
}

describe("ThemeProvider server render -> client hydrate", () => {
  afterEach(() => {
    uninstallJsdomGlobals();
    vi.restoreAllMocks();
  });

  it("renders on the server with no `window`", () => {
    expect(typeof window).toBe("undefined");
    expect(() => renderToString(<Tree />)).not.toThrow();
  });

  it("does not warn of a hydration mismatch when a dark theme was already stored on the client", async () => {
    const serverHtml = renderToString(<Tree />);

    installJsdomGlobals("dark");
    const { hydrateRoot } = await import("react-dom/client");
    const container = document.getElementById("root")!;
    container.innerHTML = serverHtml;

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // `act` flushes the passive effects too (the matchMedia listener setup,
    // `applyResolvedTheme`), not just the layout effect that corrects the
    // theme — without it they fire on the next tick, after this test's
    // `afterEach` has already torn down the jsdom globals they need.
    await act(async () => {
      hydrateRoot(container, <Tree />);
    });

    const mismatchWarnings = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes("didn't match the client properties"),
    );
    expect(mismatchWarnings).toEqual([]);
  });
});
