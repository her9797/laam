"use client";

import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Layout shell shared by every list screen's search/filter/sort row. Owns
 * only the search input — filter and sort controls are feature-specific
 * (different fields, different option sets) and passed in as `children` so
 * this stays a layout primitive rather than a one-size-fits-all form.
 */
export function ListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  children,
  className,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchAriaLabel?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Input
        type="search"
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchAriaLabel ?? searchPlaceholder}
        className="max-w-xs"
      />
      {children}
    </div>
  );
}
