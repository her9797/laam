export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "lam-admin.theme";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

const THEMES: readonly Theme[] = ["light", "dark", "system"];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Resolves a stored/selected `Theme` preference into the concrete
 * `"light" | "dark"` value that should be applied to the document.
 * `"system"` defers to the OS-level `prefers-color-scheme` signal.
 */
export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") {
    return prefersDark ? "dark" : "light";
  }
  return theme;
}

/**
 * Reads the persisted theme preference from `localStorage`, falling back to
 * `"system"` when nothing valid is stored (or `localStorage` is unavailable,
 * e.g. during server-side rendering).
 */
export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined): Theme {
  if (!storage) {
    return "system";
  }
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}

/**
 * Applies the resolved theme to the document: toggles the `.dark` class
 * (matching the `@custom-variant dark (&:is(.dark *))` rule in globals.css)
 * and sets `color-scheme` so native form controls / scrollbars match too.
 */
export function applyResolvedTheme(root: HTMLElement, resolved: ResolvedTheme): void {
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}
