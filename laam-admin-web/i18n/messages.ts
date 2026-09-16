import { en, ko, type Locale } from "./resources";

/**
 * Translation for code that runs OUTSIDE React.
 *
 * `i18n/client.ts` cannot be used here: it pulls in `react-i18next` (and
 * `useEffect`), so importing it anywhere in the server graph breaks the
 * build — and `lib/api/fetch-json.ts`, the one non-React module that needs a
 * translated string, is reachable from `app/api/*` route handlers as well as
 * from the browser.
 *
 * The current locale is read from `<html lang>`, which `i18n/client.ts` owns
 * and keeps in sync (at init, on `languageChanged`, and again after
 * hydration via `useSyncDocumentLanguage`). On the server there is no
 * document and no per-request locale — this app resolves language in the
 * browser from `localStorage` — so it falls back to the app's fallback
 * language, Korean.
 */
function currentLocale(): Locale {
  if (typeof document === "undefined") {
    return "ko";
  }
  return document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "ko";
}

/**
 * The message shown when a BFF/upstream call fails without returning an
 * `error` string of its own. Mirrors `common.requestFailed`'s single
 * `{{status}}` placeholder.
 */
export function requestFailedMessage(status: number): string {
  const resources = currentLocale() === "en" ? en : ko;
  return resources.common.requestFailed.replace("{{status}}", String(status));
}
