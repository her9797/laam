import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement these; shadcn's base-ui primitives (Sidebar's
// mobile Sheet, dialogs, etc.) reference them defensively, and the theme
// system reads `matchMedia` directly to resolve `system` theme / subscribe
// to OS scheme changes.
if (typeof window !== "undefined") {
  if (!window.localStorage) {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, String(value)),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
          return values.size;
        },
      } satisfies Storage,
    });
  }

  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }

  if (!window.ResizeObserver) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }

  // jsdom has no PointerEvent constructor at all, so `fireEvent.pointerDown`
  // et al. silently fall back to a plain `Event` that drops pointer-specific
  // init fields (clientX, pointerId, pointerType end up `undefined`) —
  // components using the Pointer Events API (e.g. the sidebar resize
  // handle, which needs it for touch support) can't be exercised without
  // this. MouseEvent already carries clientX/clientY in jsdom, so this only
  // adds the pointer-specific fields on top of it.
  if (!window.PointerEvent) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;

      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? "mouse";
        this.isPrimary = params.isPrimary ?? true;
      }
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // jsdom reports "en-US" by default. This app's fallback/browser-detected
  // language matters for component tests (react-i18next), so pin the test
  // environment's navigator language to Korean — this MVP's primary and
  // fallback locale — instead of letting an incidental jsdom default decide
  // which language components render in.
  Object.defineProperty(window.navigator, "language", {
    value: "ko-KR",
    configurable: true,
  });
  Object.defineProperty(window.navigator, "languages", {
    value: ["ko-KR", "ko"],
    configurable: true,
  });
}
