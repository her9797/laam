"use client";

import "@/i18n/client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { ErrorState, LoadingState } from "@/components/states/PageStates";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

import type { ExpenseCategory } from "./model";
import {
  useCreateExpenseCategoryMutation,
  useExpenseCategoriesQuery,
  useRenameExpenseCategoryMutation,
} from "./queries";

/**
 * Category list with add and rename. The contract has no category delete,
 * so every category — default or not — can only be renamed here; the
 * "기본" badge tells the operator which ones came with the store.
 */
export function ExpenseCategoryPanel() {
  const { t } = useTranslation("inventory");
  const headingId = useId();
  const nameInputId = useId();
  const categoriesQuery = useExpenseCategoriesQuery();
  const createMutation = useCreateExpenseCategoryMutation();
  const [name, setName] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ExpenseCategory | null>(null);

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setErrorKey("errorCategoryNameRequired");
      return;
    }
    setErrorKey(null);
    createMutation.mutate(trimmed, {
      onSuccess: (created) => {
        setName("");
        toast.add({ type: "success", title: t("categoryCreated", { name: created.name }) });
      },
      onError: () => setErrorKey("categorySaveFailed"),
    });
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-2xl border border-border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-base font-semibold text-foreground">
          {t("categoryListTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("categoryListDescription")}</p>
      </div>

      {categoriesQuery.isLoading ? (
        <LoadingState label={t("categoriesLoading")} />
      ) : categoriesQuery.isError ? (
        <ErrorState
          title={t("categoriesError")}
          message={categoriesQuery.error instanceof Error ? categoriesQuery.error.message : undefined}
          onRetry={() => categoriesQuery.refetch()}
        />
      ) : (
        <ul className="flex flex-col">
          {(categoriesQuery.data ?? []).map((category) => (
            <li
              key={category.id}
              className="flex min-h-11 items-center justify-between gap-2 border-b border-border last:border-b-0"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span className="truncate">{category.name}</span>
                {category.isDefault ? (
                  <span className="shrink-0 rounded-4xl bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    {t("categoryDefaultBadge")}
                  </span>
                ) : null}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={t("categoryRenameNamed", { name: category.name })}
                onClick={() => setRenaming(category)}
              >
                {t("categoryRename")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form className="flex flex-col gap-2" onSubmit={handleCreate} noValidate>
        <Field data-invalid={Boolean(errorKey) || undefined}>
          <FieldLabel htmlFor={nameInputId}>{t("categoryNameLabel")}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={nameInputId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("categoryNamePlaceholder")}
              aria-invalid={Boolean(errorKey)}
              className="h-11"
            />
            <Button type="submit" variant="outline" className="h-11" disabled={createMutation.isPending}>
              {t("categoryAdd")}
            </Button>
          </div>
          {errorKey ? <FieldError>{t(errorKey)}</FieldError> : null}
        </Field>
      </form>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("categoryRenameTitle")}</DialogTitle>
          </DialogHeader>
          {renaming ? (
            <RenameCategoryForm key={renaming.id} category={renaming} onDone={() => setRenaming(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RenameCategoryForm({ category, onDone }: { category: ExpenseCategory; onDone: () => void }) {
  const { t } = useTranslation("inventory");
  const inputId = useId();
  const renameMutation = useRenameExpenseCategoryMutation();
  const [name, setName] = useState(category.name);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setErrorKey("errorCategoryNameRequired");
      return;
    }
    setErrorKey(null);
    renameMutation.mutate(
      { id: category.id, name: trimmed },
      {
        onSuccess: (renamed) => {
          toast.add({ type: "success", title: t("categoryRenamed", { name: renamed.name }) });
          onDone();
        },
        onError: () => setErrorKey("categorySaveFailed"),
      },
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <Field data-invalid={Boolean(errorKey) || undefined}>
        <FieldLabel htmlFor={inputId}>{t("categoryRenameLabel")}</FieldLabel>
        <Input
          id={inputId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={Boolean(errorKey)}
          className="h-11"
        />
        {errorKey ? <FieldError>{t(errorKey)}</FieldError> : null}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:cancel")}
        </Button>
        <Button type="submit" disabled={renameMutation.isPending}>
          {t("common:save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
