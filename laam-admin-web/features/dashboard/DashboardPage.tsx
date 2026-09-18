"use client";

import "@/i18n/client";

import Link from "next/link";
import { RiArrowDownSLine, RiArrowUpSLine, RiCheckLine, RiSettings3Line } from "@remixicon/react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { useBootstrapQuery } from "@/features/bootstrap/queries";
import { seoulMonth } from "@/features/expenses/model";
import { useExpenseSummaryQuery } from "@/features/expenses/queries";
import { formatNumber } from "@/features/inventory/format";
import { useOrderCountQuery } from "@/features/orders/queries";
import { useCustomerRequestPendingSummaryQuery } from "@/features/requests/queries";
import { useSpecialRequestCountQuery } from "@/features/special-requests/queries";

import { useInventorySummaryQuery, useTodaySalesQuery } from "./queries";
import { buildDashboardSummary, type DashboardSummary } from "./summary";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type ShortcutCard = {
  key: string;
  href: string;
  /** Key in the `dashboard` namespace, resolved at render. */
  titleKey: string;
  descriptionKey: string;
  value: number;
};

const DASHBOARD_CARD_ORDER_KEY = "laam-admin.dashboard-card-order";
const DEFAULT_CARD_ORDER = ["expenses", "reorder", "sales", "general", "song", "special", "orders", "menu", "notices"];

function readCardOrder(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DASHBOARD_CARD_ORDER_KEY) ?? "null");
    if (!Array.isArray(parsed)) return DEFAULT_CARD_ORDER;
    const known = new Set(DEFAULT_CARD_ORDER);
    const saved = parsed.filter((key): key is string => typeof key === "string" && known.has(key));
    return [...saved, ...DEFAULT_CARD_ORDER.filter((key) => !saved.includes(key))];
  } catch {
    return DEFAULT_CARD_ORDER;
  }
}

// Every card links to the management route for the data it counts — the
// three built in this task (`/requests`, `/song-requests`,
// `/special-requests`) plus the menu/notice routes `AdminShell`'s nav
// already lists (Task 3) and Tasks 6/7 will implement, and `/orders` for
// the order-history count. Linking ahead here matches the nav, which
// already does the same.
function buildCards(summary: DashboardSummary): ShortcutCard[] {
  return [
    {
      key: "general",
      href: "/requests",
      titleKey: "cardGeneralTitle",
      descriptionKey: "cardGeneralDescription",
      value: summary.pendingGeneralRequestCount,
    },
    {
      key: "song",
      href: "/song-requests",
      titleKey: "cardSongTitle",
      descriptionKey: "cardSongDescription",
      value: summary.pendingSongRequestCount,
    },
    {
      key: "special",
      href: "/special-requests",
      titleKey: "cardSpecialTitle",
      descriptionKey: "cardSpecialDescription",
      value: summary.specialRequestCount,
    },
    {
      key: "orders",
      href: "/orders?status=READY",
      titleKey: "cardOrdersTitle",
      descriptionKey: "cardOrdersDescription",
      value: summary.orderCount,
    },
    {
      key: "menu",
      href: "/menu",
      titleKey: "cardMenuTitle",
      descriptionKey: "cardMenuDescription",
      value: summary.menuItemCount,
    },
    {
      key: "notices",
      href: "/notices",
      titleKey: "cardNoticesTitle",
      descriptionKey: "cardNoticesDescription",
      value: summary.noticeCount,
    },
  ];
}

type OptionalShortcutCard = {
  key: string;
  href: string;
  titleKey: string;
  descriptionKey: string;
  query: { isLoading: boolean; isError: boolean };
  /** Rendered value once the query has data. */
  value: string | null;
};

/**
 * Expense and inventory cards load on their own: their summaries are
 * separate endpoints, and a failure there (e.g. before the inventory
 * schema exists) should cost only that card, not the whole dashboard.
 */
function OptionalCardLink({ card, isEditing }: { card: OptionalShortcutCard; isEditing: boolean }) {
  const { t } = useTranslation("dashboard");
  const value = card.query.isLoading ? "…" : card.value ?? t("cardValueUnavailable");

  return (
    <CardLink href={card.href} isEditing={isEditing}>
      <Card className="transition-shadow hover:shadow-lg">
        <CardHeader>
          <CardTitle>{t(card.titleKey)}</CardTitle>
          <CardDescription>{t(card.descriptionKey)}</CardDescription>
        </CardHeader>
        <CardContent>
          <p
            className={
              card.value === null && !card.query.isLoading
                ? "text-sm text-muted-foreground"
                : "text-2xl font-semibold text-foreground"
            }
          >
            {value}
          </p>
        </CardContent>
      </Card>
    </CardLink>
  );
}

function CardLink({ href, isEditing, children }: { href: string; isEditing: boolean; children: ReactNode }) {
  return isEditing ? (
    <div className="block">{children}</div>
  ) : (
    <Link href={href} className="block">{children}</Link>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation("dashboard");
  const [isEditing, setIsEditing] = useState(false);
  const [cardOrder, setCardOrder] = useState(DEFAULT_CARD_ORDER);
  useIsomorphicLayoutEffect(() => {
    // Apply the persisted order before the browser paints, while keeping the
    // server and hydration renders identical.
    setCardOrder(readCardOrder());
  }, []);
  const expenseSummaryQuery = useExpenseSummaryQuery(seoulMonth(new Date()));
  const inventorySummaryQuery = useInventorySummaryQuery();
  const todaySalesQuery = useTodaySalesQuery();
  const optionalCards: OptionalShortcutCard[] = [
    {
      key: "expenses",
      href: "/expenses",
      titleKey: "cardExpensesTitle",
      descriptionKey: "cardExpensesDescription",
      query: expenseSummaryQuery,
      value: expenseSummaryQuery.data
        ? t("amountValue", { amount: formatNumber(expenseSummaryQuery.data.total, i18n.language) })
        : null,
    },
    {
      key: "reorder",
      href: "/inventory",
      titleKey: "cardReorderTitle",
      descriptionKey: "cardReorderDescription",
      query: inventorySummaryQuery,
      value: inventorySummaryQuery.data ? String(inventorySummaryQuery.data.reorderCount) : null,
    },
    {
      key: "sales",
      href: "/orders/stats",
      titleKey: "cardSalesTitle",
      descriptionKey: "cardSalesDescription",
      query: todaySalesQuery,
      value: todaySalesQuery.data
        ? t("amountValue", { amount: formatNumber(todaySalesQuery.data.totalRevenue, i18n.language) })
        : null,
    },
  ];
  const bootstrapQuery = useBootstrapQuery();
  const requestsQuery = useCustomerRequestPendingSummaryQuery();
  const specialRequestCountQuery = useSpecialRequestCountQuery();
  const orderCountQuery = useOrderCountQuery();

  const isLoading =
    bootstrapQuery.isLoading ||
    requestsQuery.isLoading ||
    specialRequestCountQuery.isLoading ||
    orderCountQuery.isLoading;
  const failedQuery = [bootstrapQuery, requestsQuery, specialRequestCountQuery, orderCountQuery].find(
    (query) => query.isError,
  );

  function retryAll() {
    if (bootstrapQuery.isError) {
      void bootstrapQuery.refetch();
    }
    if (requestsQuery.isError) {
      void requestsQuery.refetch();
    }
    if (specialRequestCountQuery.isError) {
      void specialRequestCountQuery.refetch();
    }
    if (orderCountQuery.isError) {
      void orderCountQuery.refetch();
    }
  }

  if (isLoading) {
    return <LoadingState label={t("loading")} />;
  }

  if (
    failedQuery ||
    !bootstrapQuery.data ||
    !requestsQuery.data ||
    !specialRequestCountQuery.data ||
    !orderCountQuery.data
  ) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={
          failedQuery?.error instanceof Error ? failedQuery.error.message : undefined
        }
        onRetry={retryAll}
      />
    );
  }

  const summary = buildDashboardSummary(
    bootstrapQuery.data,
    requestsQuery.data,
    specialRequestCountQuery.data.total,
    orderCountQuery.data.total,
  );
  const allCards = [
    ...optionalCards,
    ...buildCards(summary).map((card) => ({ ...card, query: null as null, value: String(card.value) })),
  ];
  const orderedCards = cardOrder
    .map((key) => allCards.find((card) => card.key === key))
    .filter((card): card is (typeof allCards)[number] => Boolean(card));
  const emptyStateCards = orderedCards.filter(
    (card) => card.key === "expenses" || card.key === "reorder" || card.key === "sales",
  );

  function moveCard(key: string, direction: -1 | 1) {
    setCardOrder((current) => {
      const next = [...current];
      const index = next.indexOf(key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      window.localStorage.setItem(DASHBOARD_CARD_ORDER_KEY, JSON.stringify(next));
      return next;
    });
  }
  // All 4 queries have already succeeded above (the loading/error branches
  // returned first) — "empty" here means every aggregate count is genuinely
  // zero: no pending general or song requests, no special or order-history
  // records, no menu items, no notices. That's the only state where a bare
  // "0" on every card would otherwise look indistinguishable from a
  // data-loading problem.
  const isEmpty =
    summary.pendingGeneralRequestCount === 0 &&
    summary.pendingSongRequestCount === 0 &&
    summary.specialRequestCount === 0 &&
    summary.orderCount === 0 &&
    summary.menuItemCount === 0 &&
    summary.noticeCount === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing((current) => !current)}>
          {isEditing ? <RiCheckLine data-icon="inline-start" aria-hidden="true" /> : <RiSettings3Line data-icon="inline-start" aria-hidden="true" />}
          {isEditing ? t("finishEditing") : t("editCards")}
        </Button>
      </div>
      {isEmpty ? (
        <>
          <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
          <DashboardCardGrid cards={emptyStateCards} isEditing={isEditing} onMove={moveCard} />
        </>
      ) : (
        <DashboardCardGrid cards={orderedCards} isEditing={isEditing} onMove={moveCard} />
      )}
    </div>
  );
}

type DashboardCard = {
  key: string;
  href: string;
  titleKey: string;
  descriptionKey: string;
  value: string | null;
  query: OptionalShortcutCard["query"] | null;
};

function DashboardCardGrid({
  cards,
  isEditing,
  onMove,
}: {
  cards: DashboardCard[];
  isEditing: boolean;
  onMove: (key: string, direction: -1 | 1) => void;
}) {
  const { t } = useTranslation("dashboard");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const current = cards.map((card) => card.key);
    const from = current.indexOf(String(active.id));
    const to = current.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const direction = to > from ? 1 : -1;
    for (let index = from; index !== to; index += direction) {
      onMove(String(active.id), direction);
    }
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={cards.map((card) => card.key)} strategy={rectSortingStrategy}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, index) => {
        const content = card.query ? <OptionalCardLink card={card as OptionalShortcutCard} isEditing={isEditing} /> : (
          <CardLink href={card.href} isEditing={isEditing}>
            <Card className="transition-shadow hover:shadow-lg">
              <CardHeader><CardTitle>{t(card.titleKey)}</CardTitle><CardDescription>{t(card.descriptionKey)}</CardDescription></CardHeader>
              <CardContent><p className="text-2xl font-semibold text-foreground">{card.value}</p></CardContent>
            </Card>
          </CardLink>
        );
        return (
          <SortableDashboardCard key={card.key} cardKey={card.key} isEditing={isEditing}>
            {content}
            {isEditing ? (
              <div className="absolute right-2 top-2 flex gap-1 rounded-full bg-background/95 p-1 shadow-sm ring-1 ring-border">
                <Button type="button" variant="ghost" size="icon-xs" aria-label={t("moveCardUp")} disabled={index === 0} onClick={() => onMove(card.key, -1)}><RiArrowUpSLine aria-hidden="true" /></Button>
                <Button type="button" variant="ghost" size="icon-xs" aria-label={t("moveCardDown")} disabled={index === cards.length - 1} onClick={() => onMove(card.key, 1)}><RiArrowDownSLine aria-hidden="true" /></Button>
              </div>
            ) : null}
          </SortableDashboardCard>
        );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableDashboardCard({
  cardKey,
  children,
  isEditing,
}: {
  cardKey: string;
  children: ReactNode;
  isEditing: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardKey,
    disabled: !isEditing,
  });
  return (
    <div
      ref={setNodeRef}
      className={`relative ${isEditing ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${isDragging ? "opacity-50" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(isEditing ? attributes : {})}
      {...(isEditing ? listeners : {})}
      onClick={(event) => {
        if (isEditing) event.preventDefault();
      }}
    >
      {children}
    </div>
  );
}
