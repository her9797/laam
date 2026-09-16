"use client";

import "@/i18n/client";

import { useTranslation } from "react-i18next";

import {
  RiArrowDownSLine,
  RiArrowLeftDoubleLine,
  RiArrowLeftSLine,
  RiArrowRightDoubleLine,
  RiArrowRightSLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";

export const PAGE_SIZE_OPTIONS = [10, 20, 30] as const;

const PAGE_WINDOW_SIZE = 5;

/**
 * Five consecutive pages centred on the current one, and nothing else. No
 * ellipsis markers on either side: the first/last-page buttons flanking
 * this window already say there is more beyond it, so the markers only
 * spent width — and width is what decides whether this nav fits a phone.
 * Worst case is now prev/next + first/last + five numbers = 9 x 32px +
 * 8 x 4px gaps = 320px.
 */
function getPageItems(page: number, pageCount: number): number[] {
  if (pageCount <= PAGE_WINDOW_SIZE) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const half = Math.floor(PAGE_WINDOW_SIZE / 2);
  const startPage = Math.min(Math.max(page - half, 1), pageCount - PAGE_WINDOW_SIZE + 1);

  return Array.from({ length: PAGE_WINDOW_SIZE }, (_, index) => startPage + index);
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const { t } = useTranslation("common");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const pageItems = getPageItems(currentPage, pageCount);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <div className="relative inline-flex w-fit items-center">
        <select
          aria-label={t("listPageSizeLabel")}
          className="flex h-8 items-center appearance-none rounded-3xl border border-transparent bg-input/50 pl-3 pr-8 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <RiArrowDownSLine className="pointer-events-none absolute right-2 size-4 text-muted-foreground" />
      </div>
      {/* 320px of buttons still exceeds the ~288px of content width a 320px
          phone leaves (`body`'s `min-w-80`), so the scroll affordance stays
          as the narrow-screen fallback rather than clipping a button out of
          reach. */}
      <nav
        aria-label={t("listPageNavigation")}
        className="flex max-w-full items-center gap-1 overflow-x-auto"
      >
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("listFirstPage")}
          title={t("listFirstPage")}
          disabled={currentPage <= 1}
          onClick={() => onPageChange(1)}
        >
          <RiArrowLeftDoubleLine data-icon="inline-start" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("listPrevPage")}
          title={t("listPrevPage")}
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <RiArrowLeftSLine data-icon="inline-start" aria-hidden="true" />
        </Button>
        {pageItems.map((item) => (
          <Button
            key={item}
            type="button"
            size="icon-sm"
            variant={item === currentPage ? "default" : "ghost"}
            aria-current={item === currentPage ? "page" : undefined}
            aria-label={t("listPageLabel", { page: item })}
            onClick={() => onPageChange(item)}
          >
            {item}
          </Button>
        ))}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("listNextPage")}
          title={t("listNextPage")}
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <RiArrowRightSLine data-icon="inline-end" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("listLastPage")}
          title={t("listLastPage")}
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(pageCount)}
        >
          <RiArrowRightDoubleLine data-icon="inline-end" aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}
