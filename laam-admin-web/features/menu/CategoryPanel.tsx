"use client";

import "@/i18n/client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ListToolbar } from "@/components/list/ListToolbar";
import { ListTotalCount } from "@/components/list/ListTotalCount";
import { EmptyState } from "@/components/states/PageStates";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { MenuCategory } from "@/features/bootstrap/model";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { applyListQuery, type ListQueryState } from "@/lib/list/apply-list-query";

import { CatalogResyncButton } from "./CatalogResyncButton";
import { validateCategoryForm, type CategoryFormErrors } from "./model";
import {
  useCreateCategoryMutation,
  useDeleteCategoryMutation,
  useUpdateCategoryVisibilityMutation,
} from "./queries";

type CategoryFormState = {
  id: string;
  label: string;
  isVisible: boolean;
};

const EMPTY_FORM: CategoryFormState = { id: "", label: "", isVisible: true };

const SEARCH_DEBOUNCE_MS = 300;

export function CategoryPanel({ categories }: { categories: MenuCategory[] }) {
  const { t } = useTranslation("menu");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<CategoryFormErrors>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Search-only (no sort/pagination): category counts are structurally
  // small (one per physical menu section), so those controls would add
  // clutter without a real problem to solve. Still synced to the URL —
  // same `q` param convention as `MenuManagementPage`'s — so a filtered
  // view is bookmarkable/shareable.
  const search = searchParams.get("q") ?? "";
  const updateSearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams();
      if (value) {
        params.set("q", value);
      }
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [pathname, router],
  );

  // Local, immediately-updated search box synced to the URL only after
  // debouncing — same pattern as `MenuManagementPage`/`OrderListPage`.
  const [searchInput, setSearchInput] = useState(search);
  const [syncedSearch, setSyncedSearch] = useState(search);
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setSearchInput(search);
  }

  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (debouncedSearch !== search) {
      updateSearch(debouncedSearch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const createMutation = useCreateCategoryMutation();
  const visibilityMutation = useUpdateCategoryVisibilityMutation();
  const deleteMutation = useDeleteCategoryMutation();

  // The create form's duplicate-id validation (`handleSubmit` below) must
  // see every category id regardless of this table's own search filter, so
  // it stays on the unfiltered `categories` prop.
  const deleteTarget = categories.find((category) => category.id === pendingDeleteId) ?? null;
  const listQuery: ListQueryState = { search, sort: "", order: "asc", page: 1, pageSize: 1000 };
  const { items: visibleCategories, total: visibleTotal } = applyListQuery<MenuCategory>(
    categories,
    listQuery,
    {
      searchText: (category) => `${category.label} ${category.id}`,
    },
  );

  function isVisibilityPending(id: string): boolean {
    return visibilityMutation.isPending && visibilityMutation.variables?.id === id;
  }

  function isDeletePending(id: string): boolean {
    return deleteMutation.isPending && deleteMutation.variables === id;
  }

  function openCreateDialog() {
    setForm(EMPTY_FORM);
    setErrors({});
    setIsCreateOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateCategoryForm(
      form,
      categories.map((category) => category.id),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    createMutation.mutate(
      { id: form.id.trim(), label: form.label.trim(), isVisible: form.isVisible },
      {
        onSuccess: () => {
          setForm(EMPTY_FORM);
          setIsCreateOpen(false);
        },
      },
    );
  }

  function handleConfirmDelete() {
    if (!pendingDeleteId) {
      return;
    }
    deleteMutation.mutate(pendingDeleteId, {
      onSuccess: () => setPendingDeleteId(null),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t("categoriesTitle")}</h1>
        <div className="flex items-center gap-2">
          <CatalogResyncButton />
          <Button type="button" size="sm" onClick={openCreateDialog}>
            {t("categoryAdd")}
          </Button>
        </div>
      </div>

      {categories.length > 0 ? (
        <ListToolbar
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder={t("categorySearchPlaceholder")}
        />
      ) : null}

      <ListTotalCount count={visibleTotal} />

      {categories.length === 0 ? (
        <EmptyState
          title={t("categoryEmptyTitle")}
          description={t("categoryEmptyDescription")}
        />
      ) : visibleCategories.length === 0 ? (
        <EmptyState
          title={t("common:listNoResultsTitle")}
          description={t("common:listNoResultsDescription")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">{t("columnId")}</TableHead>
              <TableHead>{t("common:columnName")}</TableHead>
              <TableHead className="w-24">{t("common:columnVisibility")}</TableHead>
              <TableHead className="w-28">{t("common:columnActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleCategories.map((category) => (
              <TableRow key={category.id}>
                <TableCell>{category.id}</TableCell>
                <TableCell>{category.label}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isVisibilityPending(category.id)}
                    onClick={() =>
                      visibilityMutation.mutate({ id: category.id, isVisible: !category.isVisible })
                    }
                  >
                    {category.isVisible ? t("common:visible") : t("common:hidden")}
                  </Button>
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={isDeletePending(category.id)}
                    onClick={() => setPendingDeleteId(category.id)}
                  >
                    {t("common:delete")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("categoryAdd")}</DialogTitle>
          </DialogHeader>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category-id">{t("categoryIdLabel")}</Label>
              <Input
                id="category-id"
                value={form.id}
                onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
                aria-invalid={Boolean(errors.id)}
              />
              {errors.id ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(errors.id)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category-label">{t("categoryNameLabel")}</Label>
              <Input
                id="category-label"
                value={form.label}
                onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                aria-invalid={Boolean(errors.label)}
              />
              {errors.label ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(errors.label)}
                </p>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isVisible}
                onChange={(event) => setForm((current) => ({ ...current, isVisible: event.target.checked }))}
              />
              {t("common:isPublic")}
            </label>

            {createMutation.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : t("categoryCreateFailed")}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                {t("common:cancel")}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {t("common:save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
            <AlertDialogTitle>{t("categoryDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? t("categoryDeleteTarget", { label: deleteTarget.label }) : ""}
              {t("common:deleteIrreversible")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/*
            A failed delete leaves this dialog open (it only closes in the
            mutation's own `onSuccess`), so the failure has to be reported
            here rather than in the page body behind the dialog — same
            `isError` surfacing as `NoticeManagementPage`/`SpecialRequestPage`,
            placed where it's actually visible.
          */}
          {deleteMutation.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : t("categoryDeleteFailed")}
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
