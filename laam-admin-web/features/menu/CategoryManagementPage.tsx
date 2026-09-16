"use client";

import "@/i18n/client";

import { useTranslation } from "react-i18next";

import { ErrorState, LoadingState } from "@/components/states/PageStates";

import { useBootstrapQuery } from "@/features/bootstrap/queries";

import { CategoryPanel } from "./CategoryPanel";

export function CategoryManagementPage() {
  const { t } = useTranslation("menu");
  const bootstrapQuery = useBootstrapQuery();

  if (bootstrapQuery.isLoading) {
    return <LoadingState label={t("loading")} />;
  }

  if (bootstrapQuery.isError) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : undefined}
        onRetry={() => bootstrapQuery.refetch()}
      />
    );
  }

  const categories = bootstrapQuery.data?.categories ?? [];

  return <CategoryPanel categories={categories} />;
}
