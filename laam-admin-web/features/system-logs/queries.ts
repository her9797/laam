import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { fetchSystemLogsPage } from "./api";
import type { SystemLogListQuery } from "./model";

export const systemLogsKeys = {
  list: (query: SystemLogListQuery) => ["systemLogs", "list", query] as const,
};

export function useSystemLogsPageQuery(query: SystemLogListQuery) {
  return useQuery({
    queryKey: systemLogsKeys.list(query),
    queryFn: () => fetchSystemLogsPage(query),
    // A revisited page or a window-focus refetch shouldn't refire against
    // the server for 30s — same policy as the other paginated list screens
    // (see `features/requests/queries.ts`).
    staleTime: 30_000,
    // Paging changes the cache key; without a placeholder the screen would
    // unmount its whole list to a spinner on every page click.
    placeholderData: keepPreviousData,
  });
}
