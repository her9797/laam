"use client";

import "@/i18n/client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { RiAddLine, RiCloseLine } from "@remixicon/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { AppData, MenuItem, MenuItemCustomLabel } from "@/features/bootstrap/model";
import { useBootstrapQuery } from "@/features/bootstrap/queries";

import {
  useMenuItemRecipeQuery,
  useUpdateMenuItemContentMutation,
  useUpdateMenuItemRecipeMutation,
} from "./queries";
import {
  DESCRIPTION_OVERRIDE_MAX_LENGTH,
  getMenuItemDisplayImage,
  MAX_MENU_ITEM_LABELS,
  MENU_LABEL_CHIP_CLASSES,
  MENU_LABEL_COLOR_OPTIONS,
  MENU_LABEL_TEXT_MAX_LENGTH,
  type UpdateMenuItemContentInput,
  type UpdateMenuItemRecipeInput,
} from "./model";

const SELECT_CLASS = "h-8 rounded-3xl border border-transparent bg-input/50 px-2 text-sm text-foreground";

/**
 * Menu item detail screen. Name/category/price stay read-only (they come
 * from the POS catalog sync). The customer-screen description override and
 * the operator's own labels (typed here, max 5) are editable and saved together through the admin
 * `content` endpoint, which returns the full `AppData` tree. The recipe
 * fields are saved through the dedicated admin-only recipe subresource
 * (never part of the shared `AppData` bootstrap tree; see `MenuItemRecipe`
 * in `./model`).
 */
export function MenuItemDetailPage({ menuItemId }: { menuItemId: string }) {
  const { t } = useTranslation("menu");
  const bootstrapQuery = useBootstrapQuery();
  const recipeQuery = useMenuItemRecipeQuery(menuItemId);
  const updateRecipeMutation = useUpdateMenuItemRecipeMutation(menuItemId);
  const updateContentMutation = useUpdateMenuItemContentMutation(menuItemId);

  // Same render-time seeding pattern as `StoreCopyPage`: seeded once from
  // the first loaded recipe response (guarded by `form === null`), never
  // re-synced from later refetches, so an in-progress edit survives a
  // background refetch. Only a successful save's own response updates it.
  const [form, setForm] = useState<UpdateMenuItemRecipeInput | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (form === null && recipeQuery.data) {
    setForm({ ingredients: recipeQuery.data.ingredients, instructions: recipeQuery.data.instructions });
  }

  // Seeded once from bootstrap the same way as the recipe form above.
  const item = bootstrapQuery.data?.items.find((candidate) => candidate.id === menuItemId);
  const [content, setContent] = useState<UpdateMenuItemContentInput | null>(null);
  // Label errors appear only after a save attempt, then track the input live.
  const [showLabelErrors, setShowLabelErrors] = useState(false);
  if (content === null && item) {
    setContent(savedContent(item));
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

  if (bootstrapQuery.isLoading) {
    return <LoadingState label={t("loading")} />;
  }

  if (!item || !content) {
    return <EmptyState title={t("detailNotFoundTitle")} description={t("detailNotFoundDescription")} />;
  }

  const category = bootstrapQuery.data?.categories.find((candidate) => candidate.id === item.categoryId);
  const displayImage = getMenuItemDisplayImage(item);
  const options = item.options ?? [];
  const saved = savedContent(item);
  const trimmedLabels = content.labels.map((label) => ({ text: label.text.trim(), color: label.color }));
  const labelErrors = labelErrorKeys(trimmedLabels);
  const isContentUnchanged =
    content.descriptionOverride === saved.descriptionOverride &&
    JSON.stringify(trimmedLabels) === JSON.stringify(saved.labels);
  const posDescription = item.posDescription ?? item.description;
  // `item.labels` is the effective list; it only shows the Toss labels while no custom label is saved.
  const posLabels = saved.labels.length === 0 ? (item.labels ?? []) : [];
  const isLabelLimitReached = content.labels.length >= MAX_MENU_ITEM_LABELS;

  function updateLabels(update: (labels: MenuItemCustomLabel[]) => MenuItemCustomLabel[]) {
    setContent((current) => (current ? { ...current, labels: update(current.labels) } : current));
  }

  function changeLabel(index: number, change: Partial<MenuItemCustomLabel>) {
    updateLabels((labels) => labels.map((label, i) => (i === index ? { ...label, ...change } : label)));
  }

  function handleContentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content) {
      return;
    }
    setStatusMessage(null);
    setShowLabelErrors(true);
    if (labelErrors.some(Boolean)) {
      return;
    }
    updateContentMutation.mutate({ descriptionOverride: content.descriptionOverride, labels: trimmedLabels }, {
      onSuccess: (appData: AppData) => {
        const savedItem = appData.items.find((candidate) => candidate.id === menuItemId);
        if (savedItem) {
          setContent(savedContent(savedItem));
        }
        setShowLabelErrors(false);
        setStatusMessage(t("detailContentSaved"));
      },
      // No onError: a failed save keeps the operator's edits.
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) {
      return;
    }

    updateRecipeMutation.mutate(form, {
      onSuccess: (recipe) => {
        setForm({ ingredients: recipe.ingredients, instructions: recipe.instructions });
        setStatusMessage(t("detailRecipeSaved"));
      },
      // No onError handler, deliberately: a failed save must leave the
      // operator's edited text in place, not revert it.
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">{t("detailTitle")}</h1>
        <Button size="sm" variant="outline" render={<Link href="/menu" />}>
          {t("detailBackToList")}
        </Button>
      </div>

      {statusMessage ? (
        <p role="status" aria-live="polite" className="text-sm text-emerald-600 dark:text-emerald-400">
          {statusMessage}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("detailBasicInfoTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 md:flex-row">
          {displayImage ? (
            // POS image hosts are provided dynamically by the API.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayImage.src}
              alt={t("itemImageAlt", { name: item.name })}
              className="aspect-square w-full rounded-3xl object-cover md:w-48"
              style={
                displayImage.focusX === undefined
                  ? undefined
                  : { objectPosition: `${displayImage.focusX}% ${displayImage.focusY}%` }
              }
            />
          ) : null}
          <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{t("itemNameLabel")}</span>
              <span className="text-sm text-foreground">{item.name}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{t("itemCategoryLabel")}</span>
              <span className="text-sm text-foreground">{category?.label ?? item.categoryId}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{t("itemPriceLabel")}</span>
              <span className="text-sm text-foreground">{item.price}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="menu-item-content-title">{t("detailContentTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            aria-labelledby="menu-item-content-title"
            className="flex flex-col gap-4"
            onSubmit={handleContentSubmit}
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="menu-item-description-override">{t("itemDescriptionLabel")}</Label>
                <span className="text-xs text-muted-foreground">
                  {t("detailContentDescriptionCount", {
                    count: content.descriptionOverride.length,
                    max: DESCRIPTION_OVERRIDE_MAX_LENGTH,
                  })}
                </span>
              </div>
              <Textarea
                id="menu-item-description-override"
                aria-describedby="menu-item-description-hint"
                maxLength={DESCRIPTION_OVERRIDE_MAX_LENGTH}
                placeholder={posDescription}
                value={content.descriptionOverride}
                onChange={(event) =>
                  setContent((current) =>
                    current ? { ...current, descriptionOverride: event.target.value } : current,
                  )
                }
              />
              <p id="menu-item-description-hint" className="text-xs text-muted-foreground">
                {posDescription
                  ? t("detailContentPosHint", { description: posDescription })
                  : t("detailContentPosHintEmpty")}
              </p>
            </div>

            <div role="group" aria-labelledby="menu-item-labels-title" className="flex flex-col gap-2">
              <span id="menu-item-labels-title" className="text-sm font-medium text-foreground">
                {t("detailContentLabelsLabel")}
              </span>
              {content.labels.length > 0 ? (
                <ol className="flex flex-col gap-2">
                  {content.labels.map((label, index) => {
                    const n = index + 1;
                    const errorKey = showLabelErrors ? labelErrors[index] : null;
                    const errorId = `menu-item-label-${index}-error`;
                    const preview = label.text.trim();
                    return (
                      // Rows are fully controlled with no local state, so index keys stay correct on removal.
                      <li key={index} className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            aria-label={t("detailContentLabelTextAria", { n })}
                            aria-invalid={errorKey ? true : undefined}
                            aria-describedby={errorKey ? errorId : undefined}
                            className="w-40"
                            maxLength={MENU_LABEL_TEXT_MAX_LENGTH}
                            value={label.text}
                            onChange={(event) => changeLabel(index, { text: event.target.value })}
                          />
                          <select
                            aria-label={t("detailContentLabelColorAria", { n })}
                            className={SELECT_CLASS}
                            value={label.color}
                            onChange={(event) => changeLabel(index, { color: event.target.value })}
                          >
                            {MENU_LABEL_COLOR_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {t(option.labelKey)}
                              </option>
                            ))}
                          </select>
                          {preview ? (
                            <span
                              data-label-color={label.color}
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                MENU_LABEL_CHIP_CLASSES[label.color] ?? "bg-muted text-foreground"
                              }`}
                            >
                              {preview}
                            </span>
                          ) : null}
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("detailContentLabelRemoveAria", { n })}
                            onClick={() => updateLabels((labels) => labels.filter((_, i) => i !== index))}
                          >
                            <RiCloseLine aria-hidden="true" />
                          </Button>
                        </div>
                        {errorKey ? (
                          <p id={errorId} className="text-xs text-destructive">
                            {t(errorKey)}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                disabled={isLabelLimitReached}
                onClick={() => updateLabels((labels) => [...labels, { text: "", color: MENU_LABEL_COLOR_OPTIONS[0].value }])}
              >
                <RiAddLine data-icon="inline-start" aria-hidden="true" />
                {t("detailContentLabelAdd")}
              </Button>
              {isLabelLimitReached ? (
                <p className="text-xs text-muted-foreground">
                  {t("detailContentLabelsLimit", { max: MAX_MENU_ITEM_LABELS })}
                </p>
              ) : null}
              {content.labels.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("detailContentLabelsFallback")}
                  {posLabels.length > 0 ? (
                    <>
                      {" "}
                      <span>
                        {t("detailContentPosLabels", { labels: posLabels.map((label) => label.text).join(", ") })}
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>

            {updateContentMutation.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {updateContentMutation.error instanceof Error
                  ? updateContentMutation.error.message
                  : t("detailContentSaveFailed")}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={isContentUnchanged || updateContentMutation.isPending}
              className="self-start"
            >
              {t("common:save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("detailOptionsTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("detailOptionsEmpty")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {options.map((option) => (
                <section key={option.id} className="flex flex-col gap-3 rounded-3xl bg-muted/50 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-medium text-foreground">{option.title}</h3>
                    <span className="text-xs text-muted-foreground">
                      {option.required
                        ? t("optionSelectionRuleRequired", {
                            min: option.minChoices,
                            max: option.maxChoices,
                          })
                        : t("optionSelectionRuleOptional", { max: option.maxChoices })}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {option.choices.map((choice) => (
                      <li
                        key={choice.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2"
                      >
                        <span className="text-sm text-foreground">{choice.title}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>
                            {choice.priceValue > 0
                              ? t("optionAdditionalPrice", {
                                  price: new Intl.NumberFormat().format(choice.priceValue),
                                })
                              : t("optionNoAdditionalPrice")}
                          </span>
                          {choice.quantityEnabled ? (
                            <span>
                              {t("optionQuantityRange", {
                                min: choice.minQuantity,
                                max: choice.maxQuantity,
                              })}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("detailRecipeTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {recipeQuery.isError ? (
            <ErrorState
              title={t("detailRecipeErrorTitle")}
              message={recipeQuery.error instanceof Error ? recipeQuery.error.message : undefined}
              onRetry={() => recipeQuery.refetch()}
            />
          ) : recipeQuery.isLoading || form === null ? (
            <LoadingState label={t("detailRecipeLoading")} />
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recipe-ingredients">{t("detailIngredientsLabel")}</Label>
                <Textarea
                  id="recipe-ingredients"
                  value={form.ingredients}
                  onChange={(event) =>
                    setForm((current) => (current ? { ...current, ingredients: event.target.value } : current))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recipe-instructions">{t("detailInstructionsLabel")}</Label>
                <Textarea
                  id="recipe-instructions"
                  value={form.instructions}
                  onChange={(event) =>
                    setForm((current) => (current ? { ...current, instructions: event.target.value } : current))
                  }
                />
              </div>

              {updateRecipeMutation.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {updateRecipeMutation.error instanceof Error
                    ? updateRecipeMutation.error.message
                    : t("detailRecipeSaveFailed")}
                </p>
              ) : null}

              <Button type="submit" disabled={updateRecipeMutation.isPending} className="self-start">
                {t("common:save")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function savedContent(item: MenuItem): UpdateMenuItemContentInput {
  return {
    descriptionOverride: item.descriptionOverride ?? "",
    labels: (item.customLabels ?? []).map((label) => ({ text: label.text, color: label.color })),
  };
}

/** Mirrors laam-api's checks (non-empty, no case-insensitive duplicates) so the save stops before a 400. */
function labelErrorKeys(labels: MenuItemCustomLabel[]): (string | null)[] {
  const seen = new Set<string>();
  return labels.map(({ text }) => {
    if (!text) {
      return "detailContentLabelRequired";
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      return "detailContentLabelDuplicate";
    }
    seen.add(key);
    return null;
  });
}
