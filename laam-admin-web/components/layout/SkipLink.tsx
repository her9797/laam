"use client";

import "@/i18n/client";

import { useTranslation } from "react-i18next";

/**
 * The single global skip link, rendered by the root layout.
 *
 * Split out of `app/layout.tsx` purely so the label can be translated: the
 * root layout is a server component, and this app resolves the locale in the
 * browser (`localStorage` via `i18next-browser-languagedetector`), so the
 * label has to be rendered client-side. The target id is owned by
 * `AdminShell`'s `<main>` and `app/login/page.tsx`'s `<main>`.
 */
export function SkipLink() {
  const { t } = useTranslation();

  return (
    <a href="#main-content" className="skip-link">
      {t("skipToContent")}
    </a>
  );
}
