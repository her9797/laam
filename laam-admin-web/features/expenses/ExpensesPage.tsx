"use client";

import "@/i18n/client";

import { RiAddLine, RiArrowLeftSLine, RiArrowRightSLine, RiImageLine } from "@remixicon/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/features/inventory/format";
import { cn } from "@/lib/utils";

import {
  PAYMENT_METHOD_LABEL_KEYS,
  compareWithPreviousMonth,
  groupReceiptsByDate,
  parseMonthParam,
  seoulMonth,
  shiftMonth,
  type ExpenseReceipt,
  type ExpenseSummary,
} from "./model";
import { useExpenseReceiptsQuery, useExpenseSummaryQuery } from "./queries";
import { ReceiptImageDialog } from "./ReceiptImageDialog";
import { ReceiptSheet } from "./ReceiptSheet";

// Segment colors only tell neighbouring segments apart; every segment's
// name and amount is always written out in the legend next to the bar.
const SEGMENT_CLASSES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

function formatMonthLabel(month: string, language: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(language, { year: "numeric", month: "long", timeZone: "UTC" }).format(
    Date.UTC(year, monthNumber - 1, 1),
  );
}

function formatDateHeading(date: string, language: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(language, {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(Date.UTC(year, month - 1, day));
}

type SheetState = { mode: "closed" } | { mode: "create" } | { mode: "edit"; receipt: ExpenseReceipt };

export function ExpensesPage() {
  const { t, i18n } = useTranslation("expenses");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const language = i18n.language;

  const month = parseMonthParam(searchParams.get("month")) ?? seoulMonth(new Date());
  const categoryId = searchParams.get("categoryId") || null;

  const summaryQuery = useExpenseSummaryQuery(month);
  const receiptsQuery = useExpenseReceiptsQuery(month, categoryId);
  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });
  const [imageReceiptId, setImageReceiptId] = useState<string | null>(null);

  const updateQuery = useCallback(
    (next: { month: string; categoryId: string | null }) => {
      const params = new URLSearchParams({ month: next.month });
      if (next.categoryId) {
        params.set("categoryId", next.categoryId);
      }
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [pathname, router],
  );

  const monthLabel = formatMonthLabel(month, language);
  const openCreate = () => setSheet({ mode: "create" });

  const addButton = (className?: string) => (
    <Button type="button" className={cn("h-11", className)} onClick={openCreate}>
      <RiAddLine data-icon="inline-start" aria-hidden="true" />
      {t("addReceipt")}
    </Button>
  );

  const header = (
    <div className="flex items-center justify-between gap-2">
      <h1 className="sr-only">{t("title")}</h1>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("previousMonth")}
          onClick={() => updateQuery({ month: shiftMonth(month, -1), categoryId })}
        >
          <RiArrowLeftSLine aria-hidden="true" />
        </Button>
        <p aria-live="polite" className="min-w-28 text-center text-lg font-semibold text-foreground">
          {monthLabel}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("nextMonth")}
          onClick={() => updateQuery({ month: shiftMonth(month, 1), categoryId })}
        >
          <RiArrowRightSLine aria-hidden="true" />
        </Button>
      </div>
      {addButton("hidden md:inline-flex")}
    </div>
  );

  let body: React.ReactNode;
  if (summaryQuery.isLoading) {
    body = <LoadingState label={t("loading")} />;
  } else if (summaryQuery.isError || !summaryQuery.data) {
    body = (
      <ErrorState
        title={t("errorTitle")}
        message={summaryQuery.error instanceof Error ? summaryQuery.error.message : undefined}
        onRetry={() => summaryQuery.refetch()}
      />
    );
  } else if (summaryQuery.data.receiptCount === 0 && categoryId === null) {
    body = (
      <EmptyState
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        action={addButton("mt-2")}
      />
    );
  } else {
    const summary = summaryQuery.data;
    body = (
      <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-start">
        <div className="flex flex-col gap-6">
          <MonthTotal summary={summary} />
          <CategoryBreakdown
            summary={summary}
            selectedId={categoryId}
            onToggle={(id) => updateQuery({ month, categoryId: id === categoryId ? null : id })}
          />
        </div>
        <ReceiptList
          query={receiptsQuery}
          isFiltered={categoryId !== null}
          onClearFilter={() => updateQuery({ month, categoryId: null })}
          onOpen={(receipt) => setSheet({ mode: "edit", receipt })}
          onViewPhoto={setImageReceiptId}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-20 md:pb-0">
      {header}
      {body}

      {/* Phone: the add button stays reachable at the bottom of the screen. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background p-4 md:hidden">
        {addButton("w-full")}
      </div>

      <ReceiptSheet
        open={sheet.mode !== "closed"}
        receipt={sheet.mode === "edit" ? sheet.receipt : null}
        onOpenChange={(open) => !open && setSheet({ mode: "closed" })}
        onViewPhoto={setImageReceiptId}
      />
      <ReceiptImageDialog receiptId={imageReceiptId} onOpenChange={(open) => !open && setImageReceiptId(null)} />
    </div>
  );
}

function MonthTotal({ summary }: { summary: ExpenseSummary }) {
  const { t, i18n } = useTranslation("expenses");
  const language = i18n.language;
  const comparison = compareWithPreviousMonth(summary.total, summary.previousMonthTotal);
  const comparisonText =
    comparison.kind === "same"
      ? t("comparedSame")
      : t(comparison.kind === "less" ? "comparedLess" : "comparedMore", {
          amount: formatNumber(comparison.difference, language),
        });

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-sm text-muted-foreground">{t("monthTotalLabel")}</h2>
      <p className="text-4xl font-bold tracking-tight text-foreground tabular-nums">
        {t("amountValue", { amount: formatNumber(summary.total, language) })}
      </p>
      <p className="text-sm text-foreground">{comparisonText}</p>
      <p className="text-xs text-muted-foreground">{t("receiptCount", { count: summary.receiptCount })}</p>
    </section>
  );
}

function CategoryBreakdown({
  summary,
  selectedId,
  onToggle,
}: {
  summary: ExpenseSummary;
  selectedId: string | null;
  onToggle: (categoryId: string) => void;
}) {
  const { t, i18n } = useTranslation("expenses");
  const headingId = useId();
  const hintId = useId();
  const language = i18n.language;
  const categories = summary.byCategory;
  const sum = categories.reduce((total, category) => total + category.amount, 0);
  const percentOf = (amount: number) => (sum === 0 ? 0 : Math.round((amount / sum) * 100));

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-sm font-semibold text-foreground">
        {t("categoryBreakdownTitle")}
      </h2>
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("categoryEmpty")}</p>
      ) : (
        <>
          <div aria-hidden="true" className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
            {categories.map((category, index) => (
              <span
                key={category.categoryId}
                className={cn(
                  SEGMENT_CLASSES[index % SEGMENT_CLASSES.length],
                  "h-full transition-opacity",
                  selectedId !== null && selectedId !== category.categoryId && "opacity-30",
                )}
                style={{ width: `${sum === 0 ? 0 : (category.amount / sum) * 100}%` }}
              />
            ))}
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            {t("categoryFilterHint")}
          </p>
          <ul className="flex flex-col gap-1" aria-describedby={hintId}>
            {categories.map((category, index) => {
              const isSelected = selectedId === category.categoryId;
              return (
                <li key={category.categoryId}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                      isSelected && "bg-secondary font-semibold",
                    )}
                    onClick={() => onToggle(category.categoryId)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn("size-2.5 shrink-0 rounded-full", SEGMENT_CLASSES[index % SEGMENT_CLASSES.length])}
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground">{category.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {t("categoryAmount", {
                        amount: formatNumber(category.amount, language),
                        percent: percentOf(category.amount),
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function ReceiptList({
  query,
  isFiltered,
  onClearFilter,
  onOpen,
  onViewPhoto,
}: {
  query: ReturnType<typeof useExpenseReceiptsQuery>;
  isFiltered: boolean;
  onClearFilter: () => void;
  onOpen: (receipt: ExpenseReceipt) => void;
  onViewPhoto: (receiptId: string) => void;
}) {
  const { t, i18n } = useTranslation("expenses");
  const headingId = useId();
  const language = i18n.language;

  let content: React.ReactNode;
  if (query.isLoading) {
    content = <LoadingState label={t("loading")} />;
  } else if (query.isError) {
    content = (
      <ErrorState
        title={t("errorTitle")}
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => query.refetch()}
      />
    );
  } else {
    const groups = groupReceiptsByDate(query.data ?? []);
    content =
      groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("filteredEmpty")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.date} className="flex flex-col gap-1">
              <h3 className="px-1 text-xs font-medium text-muted-foreground">
                {formatDateHeading(group.date, language)}
              </h3>
              <ul className="flex flex-col rounded-2xl border border-border">
                {group.receipts.map((receipt) => {
                  const vendor = receipt.vendor.trim() || t("vendorEmpty");
                  const [first, ...rest] = receipt.lines;
                  const lineSummary = first
                    ? rest.length > 0
                      ? t("lineSummaryMore", { first: first.itemName, count: rest.length })
                      : first.itemName
                    : "";
                  return (
                    <li
                      key={receipt.id}
                      className="flex items-center gap-1 border-b border-border px-2 py-1 last:border-b-0"
                    >
                      <button
                        type="button"
                        className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                        onClick={() => onOpen(receipt)}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-foreground">{vendor}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {t(PAYMENT_METHOD_LABEL_KEYS[receipt.paymentMethod])}
                            {lineSummary ? ` · ${lineSummary}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                          {t("amountValue", { amount: formatNumber(receipt.total, language) })}
                        </span>
                      </button>
                      {receipt.hasImage ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-11"
                          aria-label={`${t("viewPhoto")} · ${vendor}`}
                          onClick={() => onViewPhoto(receipt.id)}
                        >
                          <RiImageLine aria-hidden="true" />
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      );
  }

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          {t("receiptListTitle")}
        </h2>
        {isFiltered ? (
          <Button type="button" variant="outline" size="sm" onClick={onClearFilter}>
            {t("filterClear")}
          </Button>
        ) : null}
      </div>
      {content}
    </section>
  );
}
