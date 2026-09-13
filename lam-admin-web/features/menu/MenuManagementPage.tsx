"use client";

import "@/i18n/client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { RiImageLine } from "@remixicon/react";

import { ListToolbar } from "@/components/list/ListToolbar";
import { ListTotalCount } from "@/components/list/ListTotalCount";
import { Pagination } from "@/components/list/Pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useBootstrapQuery } from "@/features/bootstrap/queries";
import type { MenuItem } from "@/features/bootstrap/model";
import { applyListQuery } from "@/lib/list/apply-list-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { CatalogResyncButton } from "./CatalogResyncButton";
import { MenuItemForm } from "./MenuItemForm";
import { buildMenuListSearchParams, parseMenuListQuery, type MenuListQuery } from "./list-query-url";
import { filterItemsByCategory, getMenuItemDisplayImage } from "./model";
import { useUpdateMenuItemVisibilityMutation } from "./queries";

const SEARCH_DEBOUNCE_MS = 300;

export function MenuManagementPage() {
  const { t } = useTranslation("menu");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const bootstrapQuery = useBootstrapQuery();
  const visibilityMutation = useUpdateMenuItemVisibilityMutation();

  // Search/category/sort/pagination applies only to this table's own
  // rendering — never to the `items` passed to `MenuItemForm` below, which
  // needs the full, unfiltered list to detect a newly-created item by
  // diffing ids. Synced to the URL (see `./list-query-url.ts`) the same
  // way `OrderListPage`/`RequestListPage` sync theirs.
  const listQuery = useMemo(() => parseMenuListQuery(searchParams), [searchParams]);

  const updateQuery = useCallback(
    (patch: Partial<MenuListQuery>) => {
      const params = buildMenuListSearchParams({ ...listQuery, ...patch });
      const queryString = params.toString();
      // `scroll: false` — see `features/orders/OrderListPage.tsx`: App Router
      // scrolls to the top of the document on every navigation, and a
      // page/filter change here is a navigation. This list pages client-side
      // from the bootstrap payload, so it needs no progress indicator — the
      // scroll jump was the only part of the paging problem it shared.
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [listQuery, pathname, router],
  );

  // Local, immediately-updated search box synced to the URL only after
  // debouncing — same pattern as `OrderListPage`/`RequestListPage`.
  const [searchInput, setSearchInput] = useState(listQuery.search);
  const [syncedSearch, setSyncedSearch] = useState(listQuery.search);
  if (listQuery.search !== syncedSearch) {
    setSyncedSearch(listQuery.search);
    setSearchInput(listQuery.search);
  }

  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (debouncedSearch !== listQuery.search) {
      updateQuery({ search: debouncedSearch, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

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
  const items = bootstrapQuery.data?.items ?? [];
  const hasCategories = categories.length > 0;

  // Category filter applies before search/sort/pagination — narrows the
  // candidate set `applyListQuery` then paginates, so "총 N건" reflects
  // the category-filtered count, not the full catalog's.
  const categoryFilteredItems = filterItemsByCategory(items, listQuery.category);

  const { items: visibleItems, total: visibleTotal } = applyListQuery<MenuItem>(categoryFilteredItems, listQuery, {
    searchText: (item) => `${item.name} ${item.description}`,
    sortValue: (item, key) => (key === "price" ? Number(item.price) || 0 : item.name),
  });

  const ITEM_SORT_LABELS: Record<string, string> = {
    none: t("common:filterAll"),
    name: t("itemSortByName"),
    price: t("itemSortByPrice"),
  };
  const CATEGORY_FILTER_LABELS: Record<string, string> = {
    all: t("common:filterAll"),
    ...Object.fromEntries(categories.map((category) => [category.id, category.label])),
  };

  function isVisibilityPending(id: string): boolean {
    return visibilityMutation.isPending && visibilityMutation.variables?.id === id;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <CatalogResyncButton />
          <MenuItemForm categories={categories} items={items} />
        </div>
      </div>

      {!hasCategories ? (
        <p className="text-sm text-muted-foreground">{t("noCategoriesHint")}</p>
      ) : null}
      {items.length > 0 ? (
        <ListToolbar
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder={t("itemSearchPlaceholder")}
          className="items-end"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="menu-category-filter">{t("itemCategoryFilterLabel")}</Label>
            <Select
              value={listQuery.category || "all"}
              onValueChange={(value) =>
                updateQuery({ category: value === "all" ? "" : String(value), page: 1 })
              }
            >
              <SelectTrigger
                id="menu-category-filter"
                size="sm"
                className="w-32"
                aria-label={t("itemCategoryFilterLabel")}
              >
                <SelectValue placeholder={t("itemCategoryFilterLabel")}>
                  {(value: string) => CATEGORY_FILTER_LABELS[value] ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common:filterAll")}</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="menu-sort">{t("common:sortLabel")}</Label>
            <Select
              value={listQuery.sort || "none"}
              onValueChange={(value) =>
                updateQuery({ sort: value === "none" ? "" : String(value), page: 1 })
              }
            >
              <SelectTrigger id="menu-sort" size="sm" className="w-32" aria-label={t("common:sortLabel")}>
                {/* Base UI's <Select.Value> shows the raw string value
                    unless told how to render a label for it — required
                    here since these items are plain strings. */}
                <SelectValue placeholder={t("common:sortLabel")}>
                  {(value: string) => ITEM_SORT_LABELS[value] ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("common:filterAll")}</SelectItem>
                <SelectItem value="name">{t("itemSortByName")}</SelectItem>
                <SelectItem value="price">{t("itemSortByPrice")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </ListToolbar>
      ) : null}

      <ListTotalCount count={visibleTotal} />

      {items.length === 0 ? (
        <EmptyState title={t("itemEmptyTitle")} description={t("itemEmptyDescription")} />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          title={t("common:listNoResultsTitle")}
          description={t("common:listNoResultsDescription")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{t("columnImage")}</TableHead>
              <TableHead>{t("common:columnName")}</TableHead>
              <TableHead className="w-32">{t("columnCategory")}</TableHead>
              <TableHead className="w-24">{t("columnPrice")}</TableHead>
              <TableHead className="w-44">{t("columnOptions")}</TableHead>
              <TableHead className="w-24">{t("common:columnVisibility")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleItems.map((item) => {
              const category = categories.find((candidate) => candidate.id === item.categoryId);
              const displayImage = getMenuItemDisplayImage(item);
              const options = item.options ?? [];
              const choiceCount = options.reduce((total, option) => total + option.choices.length, 0);
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    {displayImage ? (
                      // POS image hosts are provided dynamically by the API.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={displayImage.src}
                        alt={t("itemImageAlt", { name: item.name })}
                        className="size-12 shrink-0 rounded-2xl object-cover"
                        style={
                          displayImage.focusX === undefined
                            ? undefined
                            : { objectPosition: `${displayImage.focusX}% ${displayImage.focusY}%` }
                        }
                      />
                    ) : (
                      <div
                        role="img"
                        aria-label={t("itemImageEmptyAlt", { name: item.name })}
                        className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground"
                      >
                        <RiImageLine className="size-5" aria-hidden="true" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/menu/${item.id}`}
                      className="text-foreground underline underline-offset-4 hover:font-bold"
                    >
                      {item.name}
                    </Link>
                  </TableCell>
                  <TableCell>{category?.label ?? item.categoryId}</TableCell>
                  <TableCell>{item.price}</TableCell>
                  <TableCell>
                    {options.length > 0 ? (
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm text-foreground">
                          {t("optionSummary", { optionCount: options.length, choiceCount })}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {options.map((option) => option.title).join(" · ")}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t("noOptions")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isVisibilityPending(item.id)}
                      onClick={() =>
                        visibilityMutation.mutate({ id: item.id, isVisible: !item.isVisible })
                      }
                    >
                      {item.isVisible ? t("common:visible") : t("common:hidden")}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {items.length > 0 ? (
        <Pagination
          page={listQuery.page}
          pageSize={listQuery.pageSize}
          total={visibleTotal}
          onPageChange={(page) => updateQuery({ page })}
          onPageSizeChange={(pageSize) => updateQuery({ pageSize, page: 1 })}
        />
      ) : null}
    </div>
  );
}
