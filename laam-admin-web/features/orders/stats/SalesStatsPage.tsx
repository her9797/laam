"use client";

import "@/i18n/client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RiQuestionLine } from "@remixicon/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import { Input } from "@/components/ui/input";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrencyKRW } from "@/lib/utils";

import { defaultDateRange, resolveDateRange, type DayBasis } from "./date-range";
import type { TrendUnit } from "./model";
import { useSalesStatsQuery } from "./queries";

// The screen's own default: business-day boundaries (16:00-06:00), matching
// the order-history screen's "오늘" preset — see `../business-day.ts`.
const DEFAULT_BASIS: DayBasis = "business";

// One color per pie slice/bar, cycling through the theme's 5-hue categorical
// chart palette (`app/globals.css`'s `--chart-1`..`--chart-5`) rather than
// hardcoding colors, so charts stay correct — and adjacent slices stay
// distinguishable — in both light and dark theme.
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const TREND_UNIT_LABEL_KEY: Record<TrendUnit, string> = {
  day: "statsTrendUnitDay",
  week: "statsTrendUnitWeek",
  month: "statsTrendUnitMonth",
};

// A fixed, arbitrary placeholder passed to `useSalesStatsQuery` before the
// real default range is set (see `SalesStatsPage`'s mount effect) — never
// actually fetched with, since the query's `enabled` flag stays false
// until then.
const EPOCH = new Date(0);

function ShareChart({
  data,
  nameKey,
  ariaLabel,
}: {
  data: Array<{ revenue: number; orderCount: number }>;
  nameKey: string;
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel} className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="revenue" nameKey={nameKey} outerRadius="80%">
            {data.map((_, index) => (
              <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <RechartsTooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SalesStatsPage() {
  const { t, i18n } = useTranslation("orders");
  // The basis toggle needs no mount-effect trick — unlike the date range
  // below, its default ("business") doesn't depend on the clock, so it's
  // identical on the server's render and the client's hydration render.
  const [basis, setBasis] = useState<DayBasis>(DEFAULT_BASIS);

  // Both start blank — deterministic on the server and on the client's
  // first render, unlike calling `defaultDateRange()` (which reads
  // `new Date()`) directly here. Next.js still renders this "use client"
  // page once on the server for its initial HTML, and hydrates on the
  // client against a *separately evaluated* initial render; two `new
  // Date()` reads, at whatever instant each side happens to run, are not
  // guaranteed to land on the same business day, which previously produced
  // React error #418 ("hydration failed") whenever they didn't agree. The
  // effect below applies the real default exactly once, client-side only,
  // after mount — under the initial (default) basis; toggling the basis
  // afterward only changes how the *same* picked dates are interpreted
  // (see `currentResult` below), it doesn't reset them.
  const [fromStr, setFromStr] = useState("");
  const [toStr, setToStr] = useState("");
  useEffect(() => {
    const initial = defaultDateRange(DEFAULT_BASIS);
    // This is the one deliberate exception to the lint rule's advice:
    // there is no render-time computation of "today" that both the server
    // and the client can agree on, so applying it after mount (accepting
    // the one extra render pass) is the fix, not the problem.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFromStr(initial.from);
    setToStr(initial.to);
  }, []);

  const [lastValidRange, setLastValidRange] = useState<{ from: Date; to: Date } | null>(null);

  const currentResult = resolveDateRange(fromStr, toStr, basis);
  // React's "adjust state during render" pattern (guarded, not an effect) —
  // same approach `RequestListPage`/`SpecialRequestPage` use to keep a local
  // input in sync with a derived value without an extra render's lag.
  if (
    currentResult.ok &&
    (lastValidRange === null ||
      currentResult.from.getTime() !== lastValidRange.from.getTime() ||
      currentResult.to.getTime() !== lastValidRange.to.getTime())
  ) {
    setLastValidRange({ from: currentResult.from, to: currentResult.to });
  }

  // Only fires once a real range exists (post-mount) — before that,
  // `lastValidRange` is a placeholder the query must not actually fetch
  // with (see `useSalesStatsQuery`'s `enabled` option).
  const statsQuery = useSalesStatsQuery(
    lastValidRange?.from ?? EPOCH,
    lastValidRange?.to ?? EPOCH,
    basis,
    lastValidRange !== null,
  );

  const BASIS_LABELS: Record<string, string> = {
    business: t("statsBasisBusiness"),
    calendar: t("statsBasisCalendar"),
  };

  const dateControls = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stats-from">{t("statsFromLabel")}</Label>
        <Input
          id="stats-from"
          type="date"
          value={fromStr}
          onChange={(event) => setFromStr(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stats-to">{t("statsToLabel")}</Label>
        <Input id="stats-to" type="date" value={toStr} onChange={(event) => setToStr(event.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <Label htmlFor="stats-basis">{t("statsBasisLabel")}</Label>
          <Popover>
            <PopoverTrigger
              aria-label={t("statsBasisHelp")}
              className="text-muted-foreground"
            >
              <RiQuestionLine className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent className="w-64">{t("statsBasisHelp")}</PopoverContent>
          </Popover>
        </div>
        <Select value={basis} onValueChange={(value) => setBasis(value as DayBasis)}>
          <SelectTrigger id="stats-basis" size="sm" aria-label={t("statsBasisLabel")}>
            <SelectValue placeholder={t("statsBasisLabel")}>
              {(value: string) => BASIS_LABELS[value] ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="business">{t("statsBasisBusiness")}</SelectItem>
            <SelectItem value="calendar">{t("statsBasisCalendar")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("statsTitle")}</h1>
      {dateControls}

      {lastValidRange === null ? (
        <LoadingState label={t("statsLoading")} />
      ) : !currentResult.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {t("statsInvalidRange")}
        </p>
      ) : statsQuery.isLoading ? (
        <LoadingState label={t("statsLoading")} />
      ) : statsQuery.isError ? (
        <ErrorState
          title={t("statsErrorTitle")}
          message={statsQuery.error instanceof Error ? statsQuery.error.message : undefined}
          onRetry={() => statsQuery.refetch()}
        />
      ) : !statsQuery.data || statsQuery.data.summary.orderCount === 0 ? (
        <EmptyState title={t("statsEmptyTitle")} description={t("statsEmptyDescription")} />
      ) : (
        <SalesStatsContent data={statsQuery.data} t={t} language={i18n.language} />
      )}
    </div>
  );
}

function SalesStatsContent({
  data,
  t,
  language,
}: {
  data: NonNullable<ReturnType<typeof useSalesStatsQuery>["data"]>;
  t: (key: string, options?: Record<string, unknown>) => string;
  language: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>{t("statsSummaryRevenue")}</CardDescription>
            <CardTitle className="text-2xl">{formatCurrencyKRW(data.summary.totalRevenue, language)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("statsSummaryOrderCount")}</CardDescription>
            <CardTitle className="text-2xl">{data.summary.orderCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("statsSummaryAverageOrderValue")}</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrencyKRW(data.summary.averageOrderValue, language)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {t("statsTrendTitle")} ({t(TREND_UNIT_LABEL_KEY[data.trend.unit])})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.trend.buckets}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bucket" />
                <YAxis />
                <RechartsTooltip formatter={(value) => formatCurrencyKRW(Number(value), language)} />
                <Bar dataKey="revenue" fill={CHART_COLORS[0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("statsByCategoryTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ShareChart data={data.byCategory} nameKey="categoryName" ariaLabel={t("statsByCategoryTitle")} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("statsByPaymentMethodTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ShareChart
              data={data.byPaymentMethod}
              nameKey="paymentMethod"
              ariaLabel={t("statsByPaymentMethodTitle")}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("statsByMenuItemTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Same Table form as the by-table breakdown below, wrapped in its
              own fixed-height scroll area: the product catalog can run
              long, and this keeps the card's own footprint from growing
              with it instead of pushing the rest of the page down. */}
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columnMenuItem")}</TableHead>
                  <TableHead className="w-32">{t("columnRevenue")}</TableHead>
                  <TableHead className="w-24">{t("columnOrderCount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byMenuItem.map((row) => (
                  <TableRow key={row.menuItemName}>
                    <TableCell>{row.menuItemName || "-"}</TableCell>
                    <TableCell>{formatCurrencyKRW(row.revenue, language)}</TableCell>
                    <TableCell>{row.orderCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("statsByTableTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/3">{t("common:columnTable")}</TableHead>
                <TableHead className="w-1/3">{t("columnRevenue")}</TableHead>
                <TableHead className="w-1/3">{t("columnOrderCount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byTable.map((row) => (
                <TableRow key={row.tableNumber}>
                  <TableCell>{row.tableNumber || "-"}</TableCell>
                  <TableCell>{formatCurrencyKRW(row.revenue, language)}</TableCell>
                  <TableCell>{row.orderCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
