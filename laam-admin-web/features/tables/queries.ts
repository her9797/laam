import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createQrTable,
  fetchAdminTables,
  fetchPosTableSync,
  startPosTableSync,
  updateTablePosLink,
  type CreateQrTableInput,
} from "./api";
import { delay, runPosTableSync } from "./pos-sync";

/** Single cache entry — this screen shows the whole table layout at once, no filters/pagination. */
export const tablesKeys = {
  all: ["tables"] as const,
};

export function useAdminTablesQuery() {
  return useQuery({
    queryKey: tablesKeys.all,
    queryFn: fetchAdminTables,
  });
}

/** Invalidates the one table query every mutation on this screen changes. */
function useRefreshTables() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: tablesKeys.all });
}

/**
 * Runs a whole POS table pull — queue it, then poll until it settles — as a
 * single mutation, so the screen only has to care about `isPending` and the
 * final `PosTableSync`.
 */
export function usePosTableSyncMutation() {
  const refreshTables = useRefreshTables();
  return useMutation({
    mutationFn: () =>
      runPosTableSync({ start: startPosTableSync, poll: fetchPosTableSync, wait: delay }),
    // Even a FAILED/TIMED_OUT sync can have rewritten the snapshot, so the
    // list is refetched either way.
    onSettled: () => refreshTables(),
  });
}

export function useUpdateTablePosLinkMutation() {
  const refreshTables = useRefreshTables();
  return useMutation({
    mutationFn: ({ qrTableId, posTableId }: { qrTableId: string; posTableId: number | null }) =>
      updateTablePosLink(qrTableId, posTableId),
    onSuccess: () => refreshTables(),
  });
}

export function useCreateQrTableMutation() {
  const refreshTables = useRefreshTables();
  return useMutation({
    mutationFn: (input: CreateQrTableInput) => createQrTable(input),
    onSuccess: () => refreshTables(),
  });
}
