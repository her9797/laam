"use client";

import "@/i18n/client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { FetchJsonError } from "@/lib/api/fetch-json";

import { parseQuantity, UNIT_SUGGESTION_KEYS, type InventoryItem } from "./model";
import {
  useCreateInventoryItemMutation,
  useExpenseCategoriesQuery,
  useUpdateInventoryItemMutation,
} from "./queries";

type ItemFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when adding a new item. */
  item?: InventoryItem | null;
  /** Prefills the name when adding (e.g. the text typed into a search box). */
  initialName?: string;
  onSaved?: (item: InventoryItem) => void;
};

/**
 * Add/edit sheet for one inventory item. Reused outside the inventory
 * screens (the expense receipt form opens it from `InventoryItemCombobox`),
 * so it owns its own queries and reports the saved item through `onSaved`.
 */
export function ItemFormSheet({ open, onOpenChange, item, initialName, onSaved }: ItemFormSheetProps) {
  const { t } = useTranslation("inventory");
  const isEdit = Boolean(item);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{isEdit ? t("formEditTitle") : t("formCreateTitle")}</SheetTitle>
          <SheetDescription>{t("formDescription")}</SheetDescription>
        </SheetHeader>
        {open ? (
          <ItemForm
            key={item?.id ?? "new"}
            item={item ?? null}
            initialName={initialName ?? ""}
            onCancel={() => onOpenChange(false)}
            onSaved={(saved) => {
              onSaved?.(saved);
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

type FieldErrors = Partial<Record<"name" | "categoryId" | "unit" | "quantity" | "minQuantity", string>>;

function ItemForm({
  item,
  initialName,
  onCancel,
  onSaved,
}: {
  item: InventoryItem | null;
  initialName: string;
  onCancel: () => void;
  onSaved: (item: InventoryItem) => void;
}) {
  const { t } = useTranslation("inventory");
  const idPrefix = useId();
  const categoriesQuery = useExpenseCategoriesQuery();
  const createMutation = useCreateInventoryItemMutation();
  const updateMutation = useUpdateInventoryItemMutation();

  const [name, setName] = useState(item?.name ?? initialName);
  const [categoryId, setCategoryId] = useState<string | null>(item?.categoryId ?? null);
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [quantity, setQuantity] = useState("0");
  const [minQuantity, setMinQuantity] = useState(String(item?.minQuantity ?? 0));
  // Translation keys, so a language switch re-renders the messages too.
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<{ key: string; detail?: string } | null>(null);

  const categories = categoriesQuery.data ?? [];
  const isPending = createMutation.isPending || updateMutation.isPending;

  function validate() {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = "errorNameRequired";
    if (!categoryId) next.categoryId = "errorCategoryRequired";
    if (!unit.trim()) next.unit = "errorUnitRequired";
    if (!item && parseQuantity(quantity) === null) next.quantity = "errorQuantityInvalid";
    if (parseQuantity(minQuantity) === null) next.minQuantity = "errorMinQuantityInvalid";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleError(error: unknown) {
    if (error instanceof FetchJsonError && error.status === 409) {
      setErrors((current) => ({ ...current, name: "errorDuplicateName" }));
      setSubmitError(null);
      return;
    }
    setSubmitError({ key: "saveFailed", detail: error instanceof Error ? error.message : undefined });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    if (!validate() || !categoryId) {
      return;
    }
    const fields = {
      name: name.trim(),
      categoryId,
      unit: unit.trim(),
      minQuantity: parseQuantity(minQuantity) ?? 0,
    };

    if (item) {
      updateMutation.mutate(
        { id: item.id, input: fields },
        {
          onSuccess: (saved) => {
            toast.add({ type: "success", title: t("itemUpdated", { name: saved.name }) });
            onSaved(saved);
          },
          onError: handleError,
        },
      );
      return;
    }

    createMutation.mutate(
      {
        name: fields.name,
        categoryId: fields.categoryId,
        unit: fields.unit,
        quantity: parseQuantity(quantity) ?? 0,
        minQuantity: fields.minQuantity,
      },
      {
        onSuccess: (saved) => {
          toast.add({ type: "success", title: t("itemCreated", { name: saved.name }) });
          onSaved(saved);
        },
        onError: handleError,
      },
    );
  }

  const ids = {
    name: `${idPrefix}-name`,
    category: `${idPrefix}-category`,
    unit: `${idPrefix}-unit`,
    quantity: `${idPrefix}-quantity`,
    minQuantity: `${idPrefix}-min-quantity`,
  };

  return (
    <form className="flex flex-1 flex-col" onSubmit={handleSubmit} noValidate>
      <FieldGroup className="px-6">
        <Field data-invalid={Boolean(errors.name) || undefined}>
          <FieldLabel htmlFor={ids.name}>{t("nameLabel")}</FieldLabel>
          <Input
            id={ids.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("namePlaceholder")}
            aria-invalid={Boolean(errors.name)}
            autoComplete="off"
          />
          {errors.name ? <FieldError>{t(errors.name)}</FieldError> : null}
        </Field>

        <Field data-invalid={Boolean(errors.categoryId) || undefined}>
          <FieldLabel htmlFor={ids.category}>{t("categoryLabel")}</FieldLabel>
          {/* Native select, like the menu item form: it opens the phone's own
              picker and needs no floating popup inside the sheet. */}
          <select
            id={ids.category}
            className="h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3 text-sm text-foreground aria-invalid:border-destructive"
            value={categoryId ?? ""}
            onChange={(event) => setCategoryId(event.target.value || null)}
            aria-invalid={Boolean(errors.categoryId)}
          >
            <option value="">{t("categoryPlaceholder")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {errors.categoryId ? <FieldError>{t(errors.categoryId)}</FieldError> : null}
        </Field>

        <Field data-invalid={Boolean(errors.unit) || undefined}>
          <FieldLabel htmlFor={ids.unit}>{t("unitLabel")}</FieldLabel>
          <Input
            id={ids.unit}
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            placeholder={t("unitPlaceholder")}
            aria-invalid={Boolean(errors.unit)}
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("unitSuggestions")}>
            {UNIT_SUGGESTION_KEYS.map((key) => {
              const label = t(key);
              return (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={unit === label ? "secondary" : "outline"}
                  aria-pressed={unit === label}
                  onClick={() => setUnit(label)}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          {errors.unit ? <FieldError>{t(errors.unit)}</FieldError> : null}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          {item ? null : (
            <Field data-invalid={Boolean(errors.quantity) || undefined}>
              <FieldLabel htmlFor={ids.quantity}>{t("quantityLabel")}</FieldLabel>
              <Input
                id={ids.quantity}
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                aria-invalid={Boolean(errors.quantity)}
              />
              {errors.quantity ? <FieldError>{t(errors.quantity)}</FieldError> : null}
            </Field>
          )}
          <Field data-invalid={Boolean(errors.minQuantity) || undefined}>
            <FieldLabel htmlFor={ids.minQuantity}>{t("minQuantityLabel")}</FieldLabel>
            <Input
              id={ids.minQuantity}
              inputMode="numeric"
              value={minQuantity}
              onChange={(event) => setMinQuantity(event.target.value)}
              aria-invalid={Boolean(errors.minQuantity)}
            />
            {errors.minQuantity ? <FieldError>{t(errors.minQuantity)}</FieldError> : null}
          </Field>
        </div>
        <FieldDescription>{t("minQuantityHint")}</FieldDescription>

        {submitError ? (
          <FieldError>
            <p>{t(submitError.key)}</p>
            {submitError.detail ? <p>{submitError.detail}</p> : null}
          </FieldError>
        ) : null}
      </FieldGroup>

      <SheetFooter>
        <Button type="submit" disabled={isPending}>
          {item ? t("common:save") : t("submitCreate")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common:cancel")}
        </Button>
      </SheetFooter>
    </form>
  );
}
