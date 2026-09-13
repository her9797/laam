"use client";

import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function LoadingState({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className={cn(
        "flex min-h-32 w-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span>{label ?? t("loading")}</span>
    </div>
  );
}

/**
 * First-load placeholder for a paginated table list. Renders the same
 * `Table`/`TableHead`/`TableCell` structure as the real list — so header and
 * row heights match exactly — with each cell's content swapped for a
 * `Skeleton` bar, instead of a centered spinner that collapses the layout
 * until data arrives.
 */
export function ListSkeletonState({
  columns,
  rows = 5,
  label,
  className,
}: {
  columns: number;
  rows?: number;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div role="status" aria-label={label ?? t("loading")} className={cn("w-full", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: columns }).map((_, index) => (
              <TableHead key={index}>
                <Skeleton className="h-4 w-3/4" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <TableRow key={rowIndex}>
              {Array.from({ length: columns }).map((_, columnIndex) => (
                <TableCell key={columnIndex}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex min-h-32 w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border p-6 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-foreground">
        {title ?? t("empty")}
      </p>
      <p className="text-sm text-muted-foreground">
        {description ?? t("emptyDescription")}
      </p>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-destructive">
        {title ?? t("errorTitle")}
      </p>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      ) : null}
    </div>
  );
}
