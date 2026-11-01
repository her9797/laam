import { useMutation, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api/fetch-json";
import type { AppData } from "@/features/bootstrap/model";
import { bootstrapKeys } from "@/features/bootstrap/queries";

import type { TemplateId } from "./templates";

const STORE_TEMPLATE_PATH = "/api/admin/store-template";

/** `PATCH /api/v1/admin/store-template` answers with the full bootstrap `AppData`. */
export function updateStoreTemplate(template: TemplateId): Promise<AppData> {
  return fetchJson<AppData>(STORE_TEMPLATE_PATH, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template }),
  });
}

export function useUpdateStoreTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (template: TemplateId) => updateStoreTemplate(template),
    onSuccess: (appData: AppData) => {
      queryClient.setQueryData(bootstrapKeys.all, appData);
    },
  });
}

/** Returns a signed customer-web URL (valid 30 min) showing `template` in preview mode. */
export function createTemplatePreview(template: TemplateId): Promise<{ url: string }> {
  return fetchJson<{ url: string }>(`${STORE_TEMPLATE_PATH}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template }),
  });
}
