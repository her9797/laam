import { useMutation, useQueryClient } from "@tanstack/react-query";

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
 * trip, exactly like Task 6's `features/menu/api.ts`.
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

function useApplyBootstrapUpdate() {
  const queryClient = useQueryClient();
  return (appData: AppData) => {
    queryClient.setQueryData(bootstrapKeys.all, appData);
  };
}

export function useCreateNoticeMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: (input: CreateNoticeInput) => createNotice(input),
    onSuccess: applyBootstrapUpdate,
  });
}

export function useUpdateNoticeMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => updateNotice(id, text),
    onSuccess: applyBootstrapUpdate,
  });
}

export function useUpdateNoticeVisibilityMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) =>
      updateNoticeVisibility(id, isVisible),
    onSuccess: applyBootstrapUpdate,
  });
}

export function useDeleteNoticeMutation() {
  const applyBootstrapUpdate = useApplyBootstrapUpdate();
  return useMutation({
    mutationFn: (id: string) => deleteNotice(id),
    onSuccess: applyBootstrapUpdate,
  });
}
