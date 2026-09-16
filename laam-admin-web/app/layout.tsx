import type { Metadata } from "next";
import Script from "next/script";

import { SkipLink } from "@/components/layout/SkipLink";
import { AppProviders } from "@/components/providers/AppProviders";

import "./globals.css";

export const metadata: Metadata = {
  title: "LAM 관리자",
  description: "LAM 매장 운영자를 위한 관리자 웹",
};

// Applies the persisted (or OS) theme to <html> before first paint so the
// page never flashes the wrong theme while React hydrates. Mirrors
// `resolveTheme`/`THEME_STORAGE_KEY` in `features/settings/theme.ts` — kept
// as a standalone inline string (not an import) because it must run as a
// blocking, synchronous script before any client bundle loads.
const THEME_INIT_SCRIPT = `(function () {
  try {
    var STORAGE_KEY = "lam-admin.theme";
    var stored = window.localStorage.getItem(STORAGE_KEY);
    var theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolved = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
    var root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  } catch (error) {
    // localStorage/matchMedia can throw (e.g. disabled storage); fall back
    // to the default light theme already implied by globals.css.
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <SkipLink />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
