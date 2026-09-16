"use client";

import "@/i18n/client";

import { useTranslation } from "react-i18next";

/**
 * Shared "총 N건" line every list screen renders directly above its table
 * (or empty state), regardless of whether the screen has header action
 * buttons. Keeping this as its own row — rather than grouped with the page
 * title — is what keeps its position identical whether or not the header
 * has buttons pushing things around.
 */
export function ListTotalCount({ count }: { count: number }) {
  const { t } = useTranslation("common");

  return <div className="text-sm text-muted-foreground">{t("listTotalCount", { count })}</div>;
}
