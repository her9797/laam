"use client";

import "@/i18n/client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/states/PageStates";
import { cn } from "@/lib/utils";

import { useBootstrapQuery } from "@/features/bootstrap/queries";

import { createTemplatePreview, useUpdateStoreTemplateMutation } from "./api";
import { TEMPLATES, resolveCurrentTemplate, type TemplateId, type TemplateSwatch } from "./templates";

const GROUP_LABEL_ID = "store-template-group-label";

function MiniPreview({ swatch }: { swatch: TemplateSwatch }) {
  return (
    <div
      aria-hidden="true"
      className="relative h-24 w-full overflow-hidden rounded-md"
      style={{
        backgroundColor: swatch.background,
        border: swatch.frame ? `6px solid ${swatch.frame}` : "1px solid rgb(0 0 0 / 0.1)",
        backgroundImage: swatch.lines
          ? `repeating-linear-gradient(to bottom, transparent 0 11px, ${swatch.lines} 11px 12px)`
          : undefined,
      }}
    >
      {swatch.tabs ? (
        <div className="absolute top-0 right-2 flex gap-1">
          {swatch.tabs.map((color) => (
            <span key={color} className="h-3 w-4 rounded-b-sm" style={{ backgroundColor: color }} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 p-2.5">
        <span className="h-2 w-1/2 rounded-sm" style={{ backgroundColor: swatch.text }} />
        <span className="h-1.5 w-3/4 rounded-sm opacity-60" style={{ backgroundColor: swatch.text }} />
        <span className="h-1.5 w-2/3 rounded-sm opacity-60" style={{ backgroundColor: swatch.text }} />
        <span className="mt-1 h-3 w-12 rounded-sm" style={{ backgroundColor: swatch.accent }} />
      </div>
    </div>
  );
}

function isHttpUrl(value: unknown): value is string {
  try {
    return typeof value === "string" && ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function StoreTemplatePage() {
  const { t } = useTranslation("storeTemplate");
  const bootstrapQuery = useBootstrapQuery();
  const updateMutation = useUpdateStoreTemplateMutation();

  // Seeded once from the first loaded bootstrap (same pattern as
  // StoreCopyPage) so a background refetch never overrides the operator's pick.
  const [selected, setSelected] = useState<TemplateId | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewPending, setIsPreviewPending] = useState(false);

  const rawCurrent = bootstrapQuery.data?.store.customerTemplate;
  const current = resolveCurrentTemplate(rawCurrent);

  if (selected === null && bootstrapQuery.data) {
    setSelected(current ?? "classic");
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

  if (bootstrapQuery.isLoading || selected === null) {
    return <LoadingState label={t("loading")} />;
  }

  function handleSelect(id: TemplateId) {
    setSelected(id);
    setStatusMessage(null);
  }

  function handleApply() {
    if (!selected) {
      return;
    }
    setStatusMessage(null);
    // No onError: a failed apply keeps the operator's selection as is.
    updateMutation.mutate(selected, { onSuccess: () => setStatusMessage(t("applied")) });
  }

  async function handlePreview() {
    if (!selected) {
      return;
    }
    // Opened synchronously inside the click so popup blockers allow it; the
    // signed URL is filled in once the request resolves.
    const tab = window.open("", "_blank");
    setPreviewError(null);
    if (!tab) {
      setPreviewError(t("previewBlocked"));
      return;
    }
    tab.opener = null;
    setIsPreviewPending(true);
    try {
      const { url } = await createTemplatePreview(selected);
      if (!isHttpUrl(url)) {
        throw new Error(t("previewFailed"));
      }
      tab.location.href = url;
    } catch (error) {
      tab.close();
      setPreviewError(error instanceof Error ? error.message : t("previewFailed"));
    } finally {
      setIsPreviewPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>

      {statusMessage ? (
        <p role="status" aria-live="polite" className="text-sm text-emerald-600 dark:text-emerald-400">
          {statusMessage}
        </p>
      ) : null}

      {current === null ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
          {t("unknownCurrent", { value: rawCurrent })}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle id={GROUP_LABEL_ID}>{t("groupLabel")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div role="radiogroup" aria-labelledby={GROUP_LABEL_ID} className="grid gap-3 sm:grid-cols-3">
            {TEMPLATES.map((template) => {
              const isSelected = selected === template.id;
              return (
                <label
                  key={template.id}
                  className={cn(
                    "flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors",
                    "has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring/50",
                    isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name="store-template"
                    value={template.id}
                    checked={isSelected}
                    onChange={() => handleSelect(template.id)}
                    className="sr-only"
                  />
                  <MiniPreview swatch={template.swatch} />
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{t(template.labelKey)}</span>
                    {current === template.id ? (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                        {t("current")}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">{t(template.descriptionKey)}</span>
                </label>
              );
            })}
          </div>

          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p>{t("previewHelp")}</p>
            <p>{t("applyHelp")}</p>
          </div>

          {updateMutation.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {updateMutation.error instanceof Error ? updateMutation.error.message : t("applyFailed")}
            </p>
          ) : null}
          {previewError ? (
            <p role="alert" className="text-sm text-destructive">
              {previewError}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handlePreview} disabled={isPreviewPending}>
              {t("preview")}
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={selected === current || updateMutation.isPending}
            >
              {t("apply")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
