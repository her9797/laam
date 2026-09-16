import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { useEffect } from "react";
import { initReactI18next } from "react-i18next";

import { en, ko } from "./resources";

export const LOCALE_STORAGE_KEY = "lam-admin.locale";

const isBrowser = typeof window !== "undefined";

if (!i18n.isInitialized) {
  // The browser language detector reads `navigator`/`localStorage` when it
  // actually runs detection, which only happens during `init()`. It's safe
  // to import unconditionally, but we only register it (and let it pick the
  // language) in the browser; on the server we pin the fallback language so
  // `i18n.init` never triggers detection against absent globals.
  const instance = isBrowser ? i18n.use(LanguageDetector) : i18n;

  instance.use(initReactI18next).init({
    resources: { ko, en },
    defaultNS: "common",
    fallbackLng: "ko",
    lng: isBrowser ? undefined : "ko",
    supportedLngs: ["ko", "en"],
    load: "languageOnly",
    interpolation: { escapeValue: false },
    detection: isBrowser
      ? {
          order: ["localStorage", "navigator"],
          lookupLocalStorage: LOCALE_STORAGE_KEY,
          caches: ["localStorage"],
        }
      : undefined,
    react: { useSuspense: false },
  });
}

if (isBrowser) {
  document.documentElement.lang = i18n.resolvedLanguage ?? "ko";
  i18n.on("languageChanged", (language) => {
    document.documentElement.lang = language;
  });
}

/**
 * Re-applies `document.documentElement.lang` once this component has
 * mounted, i.e. once React hydration has committed.
 *
 * The root `<html lang="ko">` in `app/layout.tsx` is a React-owned prop.
 * `i18next-browser-languagedetector` resolves a locale restored from
 * `localStorage` synchronously inside `i18n.init()` above, which runs at
 * module-evaluation time — before hydration commits. Setting
 * `document.documentElement.lang` at that point (module-top-level, above)
 * gets overwritten back to "ko" when hydration reconciles `<html>` against
 * `app/layout.tsx`'s `lang="ko"` prop, because nothing "changes" the
 * language on this path (it's already the resolved initial language, so the
 * `languageChanged` listener above never fires for it). A live language
 * switch is unaffected because it always happens well after hydration has
 * already committed, so the listener's write is never reconciled away.
 *
 * Call this once near the app root (see `AppProviders`) so the
 * restored-from-storage case is corrected after mount, the same way
 * `ThemeProvider` re-applies the persisted theme via `useEffect` instead of
 * relying solely on the pre-hydration inline script.
 */
export function useSyncDocumentLanguage(): void {
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language ?? "ko";
  }, []);
}

export default i18n;
