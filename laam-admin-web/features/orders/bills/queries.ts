import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { orderKeys } from "../queries";
import { fetchBill, fetchBillsPage } from "./api";
import type { BillListQuery } from "./model";

/**
 * Bill keys sit under `orderKeys.all` so the `new_order` Realtime signal
 * and the 주문확인 mutation, which invalidate that whole prefix, refresh
 * bills too.
 */
export const billKeys = {
  all: [...orderKeys.all, "bills"] as const,
  list: (query: BillListQuery) => [...orderKeys.all, "bills", "list", query] as const,
  detail: (billId: string) => [...orderKeys.all, "bills", "detail", billId] as const,
};

/** Same caching behaviour as `useOrdersPageQuery` (see `../queries.ts`). */
export function useBillsPageQuery(query: BillListQuery, enabled: boolean = true) {
  return useQuery({
    queryKey: billKeys.list(query),
    queryFn: () => fetchBillsPage(query),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useBillQuery(billId: string) {
  return useQuery({
    queryKey: billKeys.detail(billId),
    queryFn: () => fetchBill(billId),
  });
}
