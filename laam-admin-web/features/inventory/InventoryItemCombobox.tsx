"use client";

import "@/i18n/client";

import { RiAddLine, RiArrowDownSLine } from "@remixicon/react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { ItemFormSheet } from "./ItemFormSheet";
import { filterInventoryItems, sortByRecentPurchase, type InventoryItem } from "./model";
import { useInventoryItemsQuery } from "./queries";

type InventoryItemComboboxProps = {
  value: string | null;
  /** Snapshot label for a selected archived item omitted from the active list. */
  fallbackLabel?: string;
  onChange: (item: InventoryItem) => void;
  id?: string;
  /**
   * Id of the parent form's visible label. The trigger is named by that
   * label followed by the selected item (a combobox takes no name from its
   * content), or by the selected item / placeholder alone when omitted.
   */
  labelId?: string;
  disabled?: boolean;
  invalid?: boolean;
};

/**
 * Searchable item picker for forms outside the inventory screens (the
 * expense receipt lines). The list opens in a sheet rather than a small
 * popup so it stays usable on a phone. Items are ordered by most recent
 * purchase. The
 * "add item" entry at the bottom opens `ItemFormSheet` in place — the
 * parent form stays mounted, so whatever the operator already typed is
 * kept — and the created item comes back through `onChange`.
 */
export function InventoryItemCombobox({
  value,
  fallbackLabel,
  onChange,
  id,
  labelId,
  disabled,
  invalid,
}: InventoryItemComboboxProps) {
  const { t } = useTranslation("inventory");
  const valueId = useId();
  const itemsQuery = useInventoryItemsQuery(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [sheetName, setSheetName] = useState("");
  // Remembers the picked item so a just-created item has a label before the
  // item list is re-fetched.
  const [picked, setPicked] = useState<InventoryItem | null>(null);

  const sortedItems = useMemo(() => sortByRecentPurchase(itemsQuery.data ?? []), [itemsQuery.data]);
  const visibleItems = filterInventoryItems(sortedItems, { categoryId: null, search });
  const selected =
    sortedItems.find((item) => item.id === value) ?? (picked?.id === value ? picked : null);
  const trimmedSearch = search.trim();

  function pick(item: InventoryItem) {
    setPicked(item);
    onChange(item);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch("");
    }
  }

  function openAddSheet() {
    setSheetName(trimmedSearch);
    handleOpenChange(false);
    setIsSheetOpen(true);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        id={id}
        role="combobox"
        aria-labelledby={labelId ? `${labelId} ${valueId}` : valueId}
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className="h-11 w-full justify-between"
        onClick={() => handleOpenChange(true)}
      >
        <span id={valueId} className="truncate">
          {selected?.name ?? (value ? fallbackLabel : undefined) ?? t("comboboxPlaceholder")}
        </span>
        <RiArrowDownSLine data-icon="inline-end" aria-hidden="true" />
      </Button>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="w-full data-[side=right]:w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("comboboxPlaceholder")}</SheetTitle>
            <SheetDescription className="sr-only">{t("comboboxSearch")}</SheetDescription>
          </SheetHeader>
          <Command shouldFilter={false} className="min-h-0 flex-1 rounded-none px-4 pb-4">
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={t("comboboxSearch")}
              aria-label={t("comboboxSearch")}
            />
            <CommandList className="max-h-none flex-1">
              <CommandGroup>
                {itemsQuery.isLoading ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">{t("comboboxLoading")}</p>
                ) : itemsQuery.isError ? (
                  <p className="px-3 py-2 text-sm text-destructive">{t("comboboxError")}</p>
                ) : visibleItems.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">{t("comboboxEmpty")}</p>
                ) : (
                  visibleItems.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      data-checked={item.id === value}
                      className="min-h-11"
                      onSelect={() => {
                        pick(item);
                        handleOpenChange(false);
                      }}
                    >
                      {item.name}
                    </CommandItem>
                  ))
                )}
              </CommandGroup>
              <CommandSeparator alwaysRender />
              <CommandGroup>
                <CommandItem value="__add-item__" className="min-h-11" onSelect={openAddSheet}>
                  <RiAddLine aria-hidden="true" />
                  {trimmedSearch ? t("comboboxAddNamed", { name: trimmedSearch }) : t("comboboxAdd")}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </SheetContent>
      </Sheet>
      <ItemFormSheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        initialName={sheetName}
        onSaved={pick}
      />
    </>
  );
}
