"use client";

import "@/i18n/client";

import { RiAddLine, RiErrorWarningLine, RiSubtractLine } from "@remixicon/react";
import Link from "next/link";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { formatNumber } from "./format";
import { ItemDetailSheet } from "./ItemDetailSheet";
import { filterInventoryItems, type ExpenseCategory } from "./model";
import {
  useExpenseCategoriesQuery,
  useInventoryItemsQuery,
  useInventoryQuantityAdjuster,
} from "./queries";
import { SetQuantityDialog } from "./SetQuantityDialog";

export function InventoryPage() {
  const { t, i18n } = useTranslation("inventory");
  const itemsQuery = useInventoryItemsQuery(false);
  const categoriesQuery = useExpenseCategoriesQuery();
  const { step } = useInventoryQuantityAdjuster();
  const reorderHeadingId = useId();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Ids rather than item snapshots, so open sheets follow cache updates.
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [setQuantityItemId, setSetQuantityItemId] = useState<string | null>(null);

  if (itemsQuery.isLoading) {
    return <LoadingState label={t("loading")} />;
  }

  if (itemsQuery.isError) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={itemsQuery.error instanceof Error ? itemsQuery.error.message : undefined}
        onRetry={() => itemsQuery.refetch()}
      />
    );
  }

  const items = itemsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const categoryName = (id: string) => categoryNames.get(id) ?? t("unknownCategory");
  const reorderItems = items.filter((item) => item.needsReorder);
  const visibleItems = filterInventoryItems(items, { categoryId, search });
  const detailItem = items.find((item) => item.id === detailItemId) ?? null;
  const setQuantityItem = items.find((item) => item.id === setQuantityItemId) ?? null;
  const language = i18n.language;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
      <Link href="/inventory/items" className={buttonVariants({ variant: "outline", size: "sm" })}>
        {t("manageItems")}
      </Link>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Link href="/inventory/items" className={cn(buttonVariants(), "mt-2")}>
              {t("goToItems")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}

      <section
        aria-labelledby={reorderHeadingId}
        className="flex flex-col gap-2 rounded-2xl border border-border p-4"
      >
        <h2 id={reorderHeadingId} className="text-sm font-semibold text-foreground">
          {t("reorderTitle", { count: reorderItems.length })}
        </h2>
        {reorderItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("reorderEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {reorderItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                  onClick={() => setDetailItemId(item.id)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {item.needsCheck ? (
                      <RiErrorWarningLine aria-hidden="true" className="size-4 shrink-0 text-destructive" />
                    ) : null}
                    <span className="truncate font-medium">{item.name}</span>
                  </span>
                  <span className={cn("shrink-0 tabular-nums text-muted-foreground", item.needsCheck && "text-destructive")}>
                    {t("reorderItemSummary", {
                      quantity: formatNumber(item.quantity, language),
                      minQuantity: formatNumber(item.minQuantity, language),
                      unit: item.unit,
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-11 md:max-w-xs"
        />
        <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} />
      </div>

      {visibleItems.length === 0 ? (
        <EmptyState
          title={t("common:listNoResultsTitle")}
          description={t("common:listNoResultsDescription")}
        />
      ) : (
        <ul className="flex flex-col rounded-2xl border border-border">
          {visibleItems.map((item) => (
            <li
              key={item.id}
              aria-label={item.name}
              className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
            >
              <button
                type="button"
                aria-label={item.name}
                className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-xl px-1 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                onClick={() => setDetailItemId(item.id)}
              >
                <span className="w-full truncate text-sm font-medium text-foreground">{item.name}</span>
                <span className="text-xs text-muted-foreground">{categoryName(item.categoryId)}</span>
                {item.needsCheck ? (
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <RiErrorWarningLine aria-hidden="true" className="size-3.5" />
                    {t("needsCheckLabel")}
                  </span>
                ) : null}
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11"
                  aria-label={t("decrease", { name: item.name })}
                  onClick={() => step(item, -1)}
                >
                  <RiSubtractLine aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className={cn("h-11 min-w-14 gap-0.5 px-2 text-base tabular-nums", item.needsCheck && "text-destructive")}
                  aria-label={t("quantityButton", {
                    name: item.name,
                    quantity: item.quantity,
                    unit: item.unit,
                  })}
                  onClick={() => setSetQuantityItemId(item.id)}
                >
                  {formatNumber(item.quantity, language)}
                  <span className="text-xs text-muted-foreground">{item.unit}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11"
                  aria-label={t("increase", { name: item.name })}
                  onClick={() => step(item, 1)}
                >
                  <RiAddLine aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ItemDetailSheet
        item={detailItem}
        categoryName={detailItem ? categoryName(detailItem.categoryId) : ""}
        onOpenChange={(open) => !open && setDetailItemId(null)}
      />
      <SetQuantityDialog
        item={setQuantityItem}
        onOpenChange={(open) => !open && setSetQuantityItemId(null)}
      />
    </div>
  );
}

function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: ExpenseCategory[];
  value: string | null;
  onChange: (categoryId: string | null) => void;
}) {
  const { t } = useTranslation("inventory");
  const options = [{ id: null, name: t("common:filterAll") }, ...categories];

  return (
    <div role="group" aria-label={t("filterLabel")} className="flex gap-2 overflow-x-auto pb-1">
      {options.map((option) => {
        const isActive = option.id === value;
        return (
          <Button
            key={option.id ?? "all"}
            type="button"
            size="sm"
            variant={isActive ? "secondary" : "outline"}
            aria-pressed={isActive}
            onClick={() => onChange(option.id)}
          >
            {option.name}
          </Button>
        );
      })}
    </div>
  );
}

