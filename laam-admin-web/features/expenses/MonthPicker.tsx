"use client";

import "@/i18n/client";

import { RiArrowDownSLine, RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { seoulMonth } from "./model";

type MonthPickerProps = {
  /** Selected month, `YYYY-MM`. */
  month: string;
  /** Already formatted label of the selected month shown on the trigger. */
  label: string;
  language: string;
  onChange: (month: string) => void;
};

function monthName(monthNumber: number, language: string): string {
  return new Intl.DateTimeFormat(language, { month: "short", timeZone: "UTC" }).format(
    Date.UTC(2000, monthNumber - 1, 1),
  );
}

export function MonthPicker({ month, label, language, onChange }: MonthPickerProps) {
  const { t } = useTranslation("expenses");
  const selectedYear = Number(month.slice(0, 4));
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selectedYear);
  const currentMonth = seoulMonth(new Date());

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setViewYear(selectedYear);
    }
    setOpen(next);
  };

  const select = (monthNumber: number) => {
    onChange(`${String(viewYear).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-live="polite"
        className="inline-flex min-h-11 min-w-28 items-center justify-center gap-1 rounded-lg px-2 text-lg font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {label}
        <RiArrowDownSLine className="size-4 text-muted-foreground" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)]">
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={t("monthPickerPreviousYear")}
            onClick={() => setViewYear((year) => year - 1)}
          >
            <RiArrowLeftSLine aria-hidden="true" />
          </Button>
          <p className="font-semibold">{t("monthPickerYear", { year: viewYear })}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={t("monthPickerNextYear")}
            onClick={() => setViewYear((year) => year + 1)}
          >
            <RiArrowRightSLine aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {Array.from({ length: 12 }, (_, index) => {
            const monthNumber = index + 1;
            const value = `${String(viewYear).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
            const selected = value === month;
            const isCurrent = value === currentMonth;
            return (
              <Button
                key={monthNumber}
                type="button"
                variant={selected ? "default" : "outline"}
                className={cn("h-11", isCurrent && !selected && "border-primary text-primary")}
                aria-pressed={selected}
                aria-current={isCurrent ? "date" : undefined}
                onClick={() => select(monthNumber)}
              >
                {monthName(monthNumber, language)}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
