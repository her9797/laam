"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  readStoredTheme,
  resolveTheme,
  type ResolvedTheme,
  type Theme,
} from "./theme";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// `useLayoutEffect` warns if it runs during server rendering; aliasing to
// `useEffect` there is harmless since neither actually runs on the server.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function getPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(THEME_MEDIA_QUERY).matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Both start at the server's defaults ("system", no OS dark preference)
  // rather than reading `localStorage`/`matchMedia` in the initializer —
  // that would return the real client-side values on the client's first
  // render and mismatch the server-rendered HTML (`ThemeMenu`'s icon and
  // aria-label), breaking hydration. There is no render-time read of
  // localStorage/matchMedia that both the server and the client's first
  // render can agree on, so applying the real values after mount is the
  // fix, not the problem — same exception already taken in `SalesStatsPage`.
  //
  // This sync runs in a *layout* effect rather than a plain effect: a plain
  // effect fires after paint, so the `applyResolvedTheme` effect below would
  // briefly apply this provider's wrong initial guess to `<html>` before the
  // correction landed — visibly undoing the very flash `app/layout.tsx`'s
  // blocking inline script exists to prevent. A layout effect's state update
  // is flushed synchronously before the browser paints, so the correction
  // lands first and that effect never observes the wrong guess.
  const [theme, setThemeState] = useState<Theme>("system");
  const [prefersDark, setPrefersDark] = useState<boolean>(false);

  useIsomorphicLayoutEffect(() => {
    setThemeState(readStoredTheme(window.localStorage));
    setPrefersDark(getPrefersDark());
  }, []);

  const resolvedTheme = resolveTheme(theme, prefersDark);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(THEME_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyResolvedTheme(document.documentElement, resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable (e.g. private mode); the in-memory
      // state below still keeps the theme selection working for this session.
    }
    setThemeState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return context;
}
