import { fetchJson } from "@/lib/api/fetch-json";

import type { DayBasis } from "./date-range";
import type { SalesStats } from "./model";

const PAYMENT_ORDER_STATS_PATH = "/api/admin/payment-orders/stats";

/**
 * Fetches aggregated sales stats for `[from, to)`. Both bounds are required
 * — unlike `features/orders/api.ts`'s order list, there is no "all time"
 * default for this screen (see `date-range.ts`'s doc comment for how a
 * picked calendar range becomes these two instants). `dayBasis` picks
 * whether the trend chart's day/week/month buckets align to calendar
 * midnight or the venue's buffered business day — see `laam-api`'s
 * `store.Repository.GetPaymentOrderStats` doc comment for the boundary
 * math this selects between.
 */
export function fetchSalesStats(from: Date, to: Date, dayBasis: DayBasis): Promise<SalesStats> {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    dayBasis,
  });

  return fetchJson<SalesStats>(`${PAYMENT_ORDER_STATS_PATH}?${params.toString()}`, {
    method: "GET",
  });
}
