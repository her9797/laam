"use client";

import "@/i18n/client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useBootstrapQuery } from "@/features/bootstrap/queries";
import type { MenuLabel } from "@/features/bootstrap/model";
import { FetchJsonError } from "@/lib/api/fetch-json";

import {
  MENU_LABEL_CHIP_CLASSES,
  MENU_LABEL_COLOR_OPTIONS,
  MENU_LABEL_TEXT_MAX_LENGTH,
  type MenuLabelInput,
} from "./model";
import { useCreateMenuLabelMutation, useDeleteMenuLabelMutation, useUpdateMenuLabelMutation } from "./queries";

const SELECT_CLASS = "h-8 rounded-3xl border border-transparent bg-input/50 px-2 text-sm text-foreground";
const EMPTY_FORM: MenuLabelInput = { text: "", color: MENU_LABEL_COLOR_OPTIONS[0].value };

export function MenuLabelChip({ label }: { label: Pick<MenuLabel, "text" | "color"> }) {
  return (
    <span
      data-label-color={label.color}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        MENU_LABEL_CHIP_CLASSES[label.color] ?? "bg-muted text-foreground"
      }`}
    >
      {label.text}
    </span>
  );
}

/**
 * Operator-managed labels a menu item can be assigned on its detail page
 * (`MenuItemDetailPage`). Every mutation returns the full `AppData`, written
 * into the bootstrap cache by `./queries`.
 */
export function MenuLabelManagementPage() {
  const { t } = useTranslation("menu");
  const bootstrapQuery = useBootstrapQuery();
  const createMutation = useCreateMenuLabelMutation();
  const updateMutation = useUpdateMenuLabelMutation();
  const deleteMutation = useDeleteMenuLabelMutation();
  const [form, setForm] = useState<MenuLabelInput>(EMPTY_FORM);
  const [nameError, setNameError] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

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

  const labels = [...(bootstrapQuery.data?.menuLabels ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const deleteTarget = labels.find((label) => label.id === pendingDeleteId) ?? null;

  function errorMessage(error: unknown, fallbackKey: string): string {
    if (error instanceof FetchJsonError && error.status === 409) {
      return t("labelDuplicate");
    }
    return error instanceof Error ? error.message : t(fallbackKey);
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = form.text.trim();
    setNameError(!text);
    if (!text) {
      return;
    }
    createMutation.mutate({ text, color: form.color }, { onSuccess: () => setForm(EMPTY_FORM) });
  }

  function handleConfirmDelete() {
    if (!pendingDeleteId) {
      return;
    }
    deleteMutation.mutate(pendingDeleteId, { onSuccess: () => setPendingDeleteId(null) });
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("labelsTitle")}</h1>

      <form
        aria-label={t("labelAdd")}
        className="flex flex-wrap items-end gap-3"
        onSubmit={handleCreate}
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="menu-label-new-text">{t("labelNameLabel")}</Label>
          <Input
            id="menu-label-new-text"
            className="w-48"
            maxLength={MENU_LABEL_TEXT_MAX_LENGTH}
            value={form.text}
            aria-invalid={nameError}
            onChange={(event) => setForm((current) => ({ ...current, text: event.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="menu-label-new-color">{t("labelColorLabel")}</Label>
          <select
            id="menu-label-new-color"
            className={SELECT_CLASS}
            value={form.color}
            onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
          >
            {MENU_LABEL_COLOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" disabled={createMutation.isPending}>
          {t("labelAdd")}
        </Button>
        {nameError || createMutation.isError ? (
          <p role="alert" className="basis-full text-sm text-destructive">
            {nameError ? t("labelNameRequired") : errorMessage(createMutation.error, "labelSaveFailed")}
          </p>
        ) : null}
      </form>

      {labels.length === 0 ? (
        <EmptyState title={t("labelEmptyTitle")} description={t("labelEmptyDescription")} />
      ) : (
        <Table className="min-w-[36rem]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">{t("columnPreview")}</TableHead>
              <TableHead>{t("common:columnName")}</TableHead>
              <TableHead className="w-28">{t("labelColorLabel")}</TableHead>
              <TableHead className="w-40">{t("common:columnActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {labels.map((label) => {
              const isUpdateTarget = updateMutation.variables?.id === label.id;
              return (
                <MenuLabelRow
                  key={label.id}
                  label={label}
                  isSaving={updateMutation.isPending && isUpdateTarget}
                  error={
                    updateMutation.isError && isUpdateTarget
                      ? errorMessage(updateMutation.error, "labelSaveFailed")
                      : null
                  }
                  onSave={(input, onSaved) =>
                    updateMutation.mutate({ id: label.id, input }, { onSuccess: onSaved })
                  }
                  onDelete={() => setPendingDeleteId(label.id)}
                />
              );
            })}
          </TableBody>
        </Table>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("labelDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? t("labelDeleteTarget", { text: deleteTarget.text }) : ""}
              {t("labelDeleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(deleteMutation.error, "labelDeleteFailed")}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={deleteMutation.isPending} onClick={handleConfirmDelete}>
              {t("common:delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MenuLabelRow({
  label,
  isSaving,
  error,
  onSave,
  onDelete,
}: {
  label: MenuLabel;
  isSaving: boolean;
  error: string | null;
  onSave: (input: MenuLabelInput, onSaved: () => void) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("menu");
  const [draft, setDraft] = useState<MenuLabelInput>({ text: label.text, color: label.color });
  const text = draft.text.trim();
  const isUnchanged = text === label.text && draft.color === label.color;

  return (
    <TableRow>
      <TableCell>
        <MenuLabelChip label={{ text: text || label.text, color: draft.color }} />
      </TableCell>
      <TableCell>
        <Input
          aria-label={t("labelRowNameAria", { text: label.text })}
          maxLength={MENU_LABEL_TEXT_MAX_LENGTH}
          value={draft.text}
          onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
        />
        {error ? (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </TableCell>
      <TableCell>
        <select
          aria-label={t("itemLabelColorAria", { text: label.text })}
          className={SELECT_CLASS}
          value={draft.color}
          onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}
        >
          {MENU_LABEL_COLOR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={isUnchanged || !text || isSaving}
            onClick={() => onSave({ text, color: draft.color }, () => setDraft({ text, color: draft.color }))}
          >
            {t("common:save")}
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={onDelete}>
            {t("common:delete")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
