"use client";

import { useEffect, useRef, useState } from "react";

import "@/i18n/client";

import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

/**
 * A request that resolves from cache (a revisited page) or in a handful of
 * ms finishes before an operator could ever perceive the bar — showing it
 * anyway is exactly the blink this component exists to prevent. Once the
 * bar has earned its place past this delay, it stays up for at least
 * `MIN_VISIBLE_MS` so it doesn't flicker off before it can be registered.
 */
const SHOW_DELAY_MS = 200;
const MIN_VISIBLE_MS = 400;

function useDelayedBarVisible(active: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      const showTimer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, SHOW_DELAY_MS);
      return () => clearTimeout(showTimer);
    }

    if (shownAtRef.current === null) {
      setVisible(false);
      return;
    }

    const elapsedMs = Date.now() - shownAtRef.current;
    const remainingMs = Math.max(MIN_VISIBLE_MS - elapsedMs, 0);
    const hideTimer = setTimeout(() => {
      shownAtRef.current = null;
      setVisible(false);
    }, remainingMs);
    return () => clearTimeout(hideTimer);
  }, [active]);

  return visible;
}

/**
 * Wraps the rows of a paginated list screen and reports when the next page
 * is on its way.
 *
 * Deliberately not a spinner that replaces the list. Swapping a full table
 * for a centred `LoadingState` on each page click is what made paging feel
 * broken: the document collapsed to a fraction of its height, the window
 * scrollbar appeared and disappeared, and the button under the operator's
 * pointer unmounted mid-click. Here the rows stay (see any list query's
 * `placeholderData`) under a 2px bar bonded to the top edge of the list.
 *
 * The bar's track is absolutely positioned and never occupies layout
 * height, whether idle, delayed, or running — so turning it on can never
 * cause the layout shift it exists to report on, and it can bond to the
 * rows' top edge without adding vertical rhythm space of its own (see
 * `useDelayedBarVisible` above for the delay/min-visible timing).
 *
 * The bar is indeterminate, with no `aria-valuenow`: a fetch in flight is
 * all the screen knows, never how far along it is.
 *
 * `active` and `stale` are two different facts and must not be collapsed
 * into one. `active` is "a request is open" — including a background
 * refetch on window focus or a Realtime broadcast, which should show the
 * bar but must never dim the rows an operator is reading. `stale` is "what
 * you are looking at is the previous page" and only drives `aria-busy` —
 * dimming the rows on top of the bar would be a duplicate signal, and drags
 * `muted-foreground` text below WCAG contrast while it's on.
 *
 * Under `prefers-reduced-motion: reduce` the global rule in
 * `app/globals.css` collapses the sweep animation, which is why the bar's
 * resting style (before any transform) is a full-width bar — it still reads
 * as busy while standing perfectly still.
 */
export function ListUpdatingRegion({
  active,
  stale,
  className,
  children,
}: {
  active: boolean;
  stale: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("common");
  const showBar = useDelayedBarVisible(active);

  return (
    <div className={cn("relative flex flex-col", className)} aria-busy={stale}>
      <div
        data-slot="list-progress-track"
        className={cn(
          "absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-full",
          showBar && "bg-primary/15",
        )}
      >
        {showBar ? (
          <div
            role="progressbar"
            aria-label={t("listUpdating")}
            className="list-progress-bar h-full w-full rounded-full bg-primary"
          />
        ) : null}
      </div>

      <div>{children}</div>
    </div>
  );
}
