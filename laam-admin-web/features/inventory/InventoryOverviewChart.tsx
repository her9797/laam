"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { formatNumber } from "./format";
import type { InventoryItem } from "./model";
import { buildStockLevels, type StockLevelStatus } from "./stock-levels";
import { summarizeStockStatus } from "./stock-status";

const ROW_HEIGHT = 30;
const AXIS_HEIGHT = 36;
// A hugely overstocked item is clamped so it can't squash the other bars; the
// real quantity is always in the value label.
const MAX_PERCENT = 200;
// Negative, empty and unset items still get a sliver so they stay visible.
const MIN_PERCENT = 3;
const MAX_NAME_LENGTH = 8;

const STATUS_COLOR: Record<StockLevelStatus, string> = {
  ok: "var(--chart-3)",
  reorder: "var(--warning)",
  check: "var(--destructive)",
  unset: "var(--muted-foreground)",
};

function truncate(name: string): string {
  return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name;
}

export function InventoryOverviewChart({ items }: { items: InventoryItem[] }) {
  const { t, i18n } = useTranslation("inventory");
  const headingId = useId();
  const language = i18n.language;
  const summary = summarizeStockStatus(items);
  const levels = buildStockLevels(items);

  const data = levels.map((level) => {
    const quantity = formatNumber(level.quantity, language);
    const min = formatNumber(level.minQuantity, language);
    const percent =
      level.ratio === null
        ? MIN_PERCENT
        : Math.min(Math.max(Math.round(level.ratio * 100), MIN_PERCENT), MAX_PERCENT);
    return {
      ...level,
      label: truncate(level.name),
      percent,
      valueLabel: level.ratio === null ? `${quantity}${level.unit}` : `${quantity}/${min}${level.unit}`,
      text:
        level.ratio === null
          ? t("levelChartItemUnset", { name: level.name, quantity, unit: level.unit })
          : t("levelChartItem", { name: level.name, quantity, min, unit: level.unit }),
    };
  });

  const legend: { key: StockLevelStatus; label: string; count: number }[] = [
    { key: "ok", label: t("statusChartOk"), count: summary.ok },
    { key: "reorder", label: t("statusChartReorder"), count: summary.reorder },
    { key: "check", label: t("statusChartCheck"), count: summary.check },
    { key: "unset", label: t("statusChartUnset"), count: summary.unset },
  ];
  const visibleLegend = legend.filter((entry) => entry.key !== "unset" || entry.count > 0);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <h2 id={headingId} className="text-sm font-semibold text-foreground">
        {t("statusChartTitle")}
      </h2>
      <div data-testid="stock-overview-summary" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-semibold text-foreground">{t("statusChartTotal", { count: summary.total })}</span>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {visibleLegend.map((entry) => (
            <li key={entry.key} className="flex items-center gap-1.5 text-foreground">
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_COLOR[entry.key] }}
              />
              <span>{entry.label}</span>
              <span className="font-semibold tabular-nums">{entry.count}</span>
            </li>
          ))}
        </ul>
      </div>
      <div
        role="img"
        aria-label={t("levelChartSummary", {
          total: summary.total,
          ok: summary.ok,
          reorder: summary.reorder,
          check: summary.check,
          unset: summary.unset,
        })}
        style={{ height: data.length * ROW_HEIGHT + AXIS_HEIGHT }}
        className="w-full min-w-0"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 84, bottom: 4, left: 0 }}>
            <XAxis type="number" domain={[0, MAX_PERCENT]} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="label" width={80} interval={0} tick={{ fontSize: 12 }} />
            <ReferenceLine x={100} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
            <Bar dataKey="percent" barSize={16} isAnimationActive={false}>
              {data.map((entry) => (
                <Cell key={entry.id} fill={STATUS_COLOR[entry.status]} />
              ))}
              <LabelList dataKey="valueLabel" position="right" fontSize={11} fill="var(--foreground)" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul data-testid="stock-overview-items" className="sr-only">
        {data.map((entry) => (
          <li key={entry.id}>{entry.text}</li>
        ))}
      </ul>
    </section>
  );
}
