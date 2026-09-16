import { useMutation, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api/fetch-json";
import type { AppData } from "@/features/bootstrap/model";
import { bootstrapKeys } from "@/features/bootstrap/queries";

const STORE_PROFILE_PATH = "/api/admin/store-profile";

/**
 * Field names and the "always send all three" constraint are grounded in
 * `laam-api/internal/httpapi/menu.go`'s `updateStoreCopiesRequest` struct and
 * its handler in `router.go`: `PATCH /api/v1/admin/store-profile` has no
 * partial-update support. If any of the three fields is empty (after trimming),
 * the server rejects the entire request with 400 Bad Request. Therefore, every
 * caller must submit the current value of all three fields together — omitting
 * one or sending it empty causes the whole request to be rejected, not a silent
 * data loss.
 */
export type StoreCopiesInput = {
  songRequestCopy: string;
  requestCopy: string;
  eventCopy: string;
};

export function updateStoreCopies(input: StoreCopiesInput): Promise<AppData> {
  return fetchJson<AppData>(STORE_PROFILE_PATH, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function useUpdateStoreCopiesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StoreCopiesInput) => updateStoreCopies(input),
    onSuccess: (appData: AppData) => {
      queryClient.setQueryData(bootstrapKeys.all, appData);
    },
  });
}
