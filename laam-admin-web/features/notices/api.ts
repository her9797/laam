import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api/fetch-json";
import type { AppData } from "@/features/bootstrap/model";
import { bootstrapKeys } from "@/features/bootstrap/queries";

const NOTICES_PATH = "/api/admin/notices";

/**
 * `laam-api`'s notice endpoints (`createNoticeRequest`/`updateNoticeRequest`/
 * `updateVisibilityRequest` in `laam-api/internal/httpapi/menu.go`, wired in
 * `router.go`) all return the full, refreshed `AppData` bootstrap tree —
 * `notices` lives in that shared tree (Task 4's design) — so callers write
 * the response straight into `bootstrapKeys.all` instead of a second round
 * trip, like Task 6's `features/menu/api.ts`, but ordered against concurrent
 * notice mutations (see `useBootstrapSnapshotWrites`).
 */

export type CreateNoticeInput = {
  text: string;
  isVisible: boolean;
};

export function createNotice(input: CreateNoticeInput): Promise<AppData> {
  return fetchJson<AppData>(NOTICES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateNotice(id: string, text: string): Promise<AppData> {
  return fetchJson<AppData>(`${NOTICES_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function updateNoticeVisibility(id: string, isVisible: boolean): Promise<AppData> {
  return fetchJson<AppData>(`${NOTICES_PATH}/${id}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isVisible }),
  });
}

export function deleteNotice(id: string): Promise<AppData> {
  return fetchJson<AppData>(`${NOTICES_PATH}/${id}`, { method: "DELETE" });
}

/**
 * Rejects blank/whitespace-only notice text before it ever reaches the
 * network — mirrors `laam-api`'s own `strings.TrimSpace(payload.Text)`
 * handling, which would otherwise silently store an empty notice.
 *
 * Returns a translation KEY in the `notices` namespace, not rendered text,
 * so this stays a pure function and the caller renders it through its own
 * `t()` in the operator's chosen language.
 */
export type NoticeValidationKey = "errorTextRequired";

export function validateNoticeText(text: string): NoticeValidationKey | undefined {
  if (!text.trim()) {
    return "errorTextRequired";
  }
  return undefined;
}

/**
 * Writing each response snapshot as it arrives lets two notice mutations in
 * flight at once (one row's visibility toggle while another row's delete is
 * pending) roll the cache back: whichever response lands last wins, even if
 * it is the older snapshot, so a deleted notice reappears. Snapshots carry
 * no version to compare, so a lone mutation still writes its snapshot
 * straight in (no extra round trip), and a refetch is only spent once
 * mutations actually overlap:
 *
 * - each mutation takes a sequence number when it starts, and its snapshot
 *   is dropped if a later-started mutation's snapshot is already cached;
 * - an in-flight bootstrap fetch (e.g. a window-focus refetch) is cancelled
 *   before writing, so its possibly older response can't land on top;
 * - start order still isn't the server's commit order, so once overlapping
 *   mutations have all settled, `bootstrapKeys.all` is invalidated once to
 *   converge on the server's latest state.
 *
 * The bookkeeping is per `QueryClient` since it tracks that client's cache,
 * and shared by all four hooks since they all write the same key.
 */
type BootstrapWriteTracker = {
  lastStarted: number;
  lastApplied: number;
  inFlight: number;
  overlapped: boolean;
};

const bootstrapWriteTrackers = new WeakMap<QueryClient, BootstrapWriteTracker>();

function getBootstrapWriteTracker(queryClient: QueryClient): BootstrapWriteTracker {
  let tracker = bootstrapWriteTrackers.get(queryClient);
  if (!tracker) {
    tracker = { lastStarted: 0, lastApplied: 0, inFlight: 0, overlapped: false };
    bootstrapWriteTrackers.set(queryClient, tracker);
  }
  return tracker;
}

function useBootstrapSnapshotWrites() {
  const queryClient = useQueryClient();
  const tracker = getBootstrapWriteTracker(queryClient);
  return {
    onMutate: () => {
      tracker.inFlight += 1;
      if (tracker.inFlight > 1) {
        tracker.overlapped = true;
      }
      tracker.lastStarted += 1;
      return { sequence: tracker.lastStarted };
    },
    onSuccess: async (appData: AppData, _variables: unknown, { sequence }: { sequence: number }) => {
      await queryClient.cancelQueries({ queryKey: bootstrapKeys.all });
      if (sequence < tracker.lastApplied) {
        return;
      }
      tracker.lastApplied = sequence;
      queryClient.setQueryData(bootstrapKeys.all, appData);
    },
    onSettled: () => {
      tracker.inFlight -= 1;
      if (tracker.inFlight === 0 && tracker.overlapped) {
        tracker.overlapped = false;
        // Not returned: the mutation's own success (and the page's status
        // message) shouldn't wait on this refetch.
        queryClient.invalidateQueries({ queryKey: bootstrapKeys.all });
      }
    },
  };
}

export function useCreateNoticeMutation() {
  const snapshotWrites = useBootstrapSnapshotWrites();
  return useMutation({
    mutationFn: (input: CreateNoticeInput) => createNotice(input),
    ...snapshotWrites,
  });
}

export function useUpdateNoticeMutation() {
  const snapshotWrites = useBootstrapSnapshotWrites();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => updateNotice(id, text),
    ...snapshotWrites,
  });
}

export function useUpdateNoticeVisibilityMutation() {
  const snapshotWrites = useBootstrapSnapshotWrites();
  return useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) =>
      updateNoticeVisibility(id, isVisible),
    ...snapshotWrites,
  });
}

export function useDeleteNoticeMutation() {
  const snapshotWrites = useBootstrapSnapshotWrites();
  return useMutation({
    mutationFn: (id: string) => deleteNotice(id),
    ...snapshotWrites,
  });
}
