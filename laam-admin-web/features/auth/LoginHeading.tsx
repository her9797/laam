"use client";

import "@/i18n/client";

import { useTranslation } from "react-i18next";

import { CardDescription, CardTitle } from "@/components/ui/card";

/**
 * Title + description for the login card. A client component only because
 * the locale is resolved in the browser, so `app/login/page.tsx` (a server
 * component, which owns the route's `metadata`) can't translate them itself.
 */
export function LoginHeading() {
  const { t } = useTranslation("auth");

  return (
    <>
      <CardTitle>{t("pageTitle")}</CardTitle>
      <CardDescription>{t("pageDescription")}</CardDescription>
    </>
  );
}
