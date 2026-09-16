import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIsMobile } from "./use-mobile";

function Probe() {
  const isMobile = useIsMobile();
  return <div data-testid="probe">{String(isMobile)}</div>;
}

describe("useIsMobile", () => {
  let container: HTMLDivElement;
  let originalInnerWidth: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    Object.defineProperty(window, "innerWidth", {
      value: originalInnerWidth,
      configurable: true,
    });
  });

  it("does not report a hydration mismatch when the real viewport is already narrower than the breakpoint", () => {
    // A server render never knows the client's viewport, so it always emits
    // the desktop ("false") markup. Capture that at the default (desktop)
    // jsdom width, before narrowing the window to simulate a mobile client.
    const serverHtml = renderToStaticMarkup(<Probe />);
    expect(serverHtml).toContain("false");
    container.innerHTML = serverHtml;

    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => {
      hydrateRoot(container, <Probe />);
    });

    const hydrationMismatchLogged = errorSpy.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("Hydration"),
    );
    expect(hydrationMismatchLogged).toBe(false);

    errorSpy.mockRestore();
  });

  it("updates to true after mount when the viewport is narrower than the breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true });

    act(() => {
      createRoot(container).render(<Probe />);
    });

    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe("true");
  });
});
