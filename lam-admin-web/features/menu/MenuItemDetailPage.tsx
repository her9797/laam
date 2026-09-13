"use client";

import "@/i18n/client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { useBootstrapQuery } from "@/features/bootstrap/queries";

import { useMenuItemRecipeQuery, useUpdateMenuItemRecipeMutation } from "./queries";
import { getMenuItemDisplayImage, type UpdateMenuItemRecipeInput } from "./model";

/**
 * Menu item detail screen: basic item info (name/category/price/
 * description) is read-only here — `lam-api` has no menu-item update
 * endpoint yet — while the recipe fields are editable and saved through
 * the dedicated admin-only recipe subresource (never part of the shared
 * `AppData` bootstrap tree; see `MenuItemRecipe` in `./model`).
 */
export function MenuItemDetailPage({ menuItemId }: { menuItemId: string }) {
  const { t } = useTranslation("menu");
  const bootstrapQuery = useBootstrapQuery();
  const recipeQuery = useMenuItemRecipeQuery(menuItemId);
  const updateRecipeMutation = useUpdateMenuItemRecipeMutation(menuItemId);

  // Same render-time seeding pattern as `StoreCopyPage`: seeded once from
  // the first loaded recipe response (guarded by `form === null`), never
  // re-synced from later refetches, so an in-progress edit survives a
  // background refetch. Only a successful save's own response updates it.
  const [form, setForm] = useState<UpdateMenuItemRecipeInput | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (form === null && recipeQuery.data) {
    setForm({ ingredients: recipeQuery.data.ingredients, instructions: recipeQuery.data.instructions });
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

  const item = bootstrapQuery.data?.items.find((candidate) => candidate.id === menuItemId);
  if (!item) {
    return <EmptyState title={t("detailNotFoundTitle")} description={t("detailNotFoundDescription")} />;
  }

  const category = bootstrapQuery.data?.categories.find((candidate) => candidate.id === item.categoryId);
  const displayImage = getMenuItemDisplayImage(item);
  const options = item.options ?? [];

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
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-sm text-muted-foreground">{t("itemDescriptionLabel")}</span>
              <span className="text-sm text-foreground">{item.description}</span>
            </div>
          </div>
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
