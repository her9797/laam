"use client";

import "@/i18n/client";

import { RiAddLine } from "@remixicon/react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

import { ExpenseCategoryPanel } from "./ExpenseCategoryPanel";
import { formatNumber } from "./format";
import { ItemFormSheet } from "./ItemFormSheet";
import type { InventoryItem } from "./model";
import {
  useExpenseCategoriesQuery,
  useInventoryItemsQuery,
  useUpdateInventoryItemMutation,
} from "./queries";

type SheetState = { mode: "closed" } | { mode: "create" } | { mode: "edit"; item: InventoryItem };

export function ItemsManagementPage() {
  const { t, i18n } = useTranslation("inventory");
  const headingId = useId();
  const [includeArchived, setIncludeArchived] = useState(false);
  const itemsQuery = useInventoryItemsQuery(includeArchived);
  const categoriesQuery = useExpenseCategoriesQuery();
  const updateMutation = useUpdateInventoryItemMutation();
  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });

  const categoryNames = new Map((categoriesQuery.data ?? []).map((category) => [category.id, category.name]));
  const items = itemsQuery.data ?? [];

  function toggleArchived(item: InventoryItem) {
    const isArchived = !item.isArchived;
    updateMutation.mutate(
      { id: item.id, input: { isArchived } },
      {
        onSuccess: (updated) =>
          toast.add({
            type: "success",
            title: t(isArchived ? "archivedToast" : "restoredToast", { name: updated.name }),
          }),
        onError: (error) =>
          toast.add({
            type: "error",
            title: t("archiveFailed"),
            description: error instanceof Error ? error.message : undefined,
          }),
      },
    );
  }

  function isArchivePending(id: string) {
    return updateMutation.isPending && updateMutation.variables?.id === id;
  }

  let itemList;
  if (itemsQuery.isLoading) {
    itemList = <LoadingState label={t("loading")} />;
  } else if (itemsQuery.isError) {
    itemList = (
      <ErrorState
        title={t("errorTitle")}
        message={itemsQuery.error instanceof Error ? itemsQuery.error.message : undefined}
        onRetry={() => itemsQuery.refetch()}
      />
    );
  } else if (items.length === 0) {
    itemList = <EmptyState title={t("itemsEmptyTitle")} description={t("itemsEmptyDescription")} />;
  } else {
    itemList = (
      <ul className="flex flex-col">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                {item.isArchived ? (
                  <span className="shrink-0 rounded-4xl bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {t("archivedBadge")}
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {categoryNames.get(item.categoryId) ?? t("unknownCategory")} ·{" "}
                {t("quantityValue", { quantity: formatNumber(item.quantity, i18n.language), unit: item.unit })} ·{" "}
                {t("minQuantityLabel")} {formatNumber(item.minQuantity, i18n.language)}
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-8"
                aria-label={t("editItemNamed", { name: item.name })}
                onClick={() => setSheet({ mode: "edit", item })}
              >
                {t("common:edit")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-8"
                aria-label={t(item.isArchived ? "restoreNamed" : "archiveNamed", { name: item.name })}
                disabled={isArchivePending(item.id)}
                onClick={() => toggleArchived(item)}
              >
                {item.isArchived ? t("restore") : t("archive")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("itemsTitle")}</h1>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <section
          aria-labelledby={headingId}
          className="flex flex-col gap-3 rounded-2xl border border-border p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={headingId} className="text-base font-semibold text-foreground">
              {t("itemListTitle")}
            </h2>
            <Button type="button" className="h-11 md:h-9" onClick={() => setSheet({ mode: "create" })}>
              <RiAddLine data-icon="inline-start" aria-hidden="true" />
              {t("addItem")}
            </Button>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            {t("showArchived")}
          </label>
          {itemList}
        </section>

        <ExpenseCategoryPanel />
      </div>

      <ItemFormSheet
        open={sheet.mode !== "closed"}
        onOpenChange={(open) => !open && setSheet({ mode: "closed" })}
        item={sheet.mode === "edit" ? sheet.item : null}
      />
    </div>
  );
}
