"use client";

import "@/i18n/client";

import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { FetchJsonError } from "@/lib/api/fetch-json";

import type { CatalogSyncResponse } from "./model";
import { useResyncCatalogMutation } from "./queries";

/**
 * Triggers `lam-api`'s Toss Place catalog sync (`cmd/server/main.go`'s
 * `startTossCatalogSync`, which otherwise only runs once at server
 * startup) so an operator can pull the latest POS data without restarting
 * the server. Shared on both the menu list and category list pages
 * (`MenuManagementPage`/`CategoryPanel`), since either screen is a
 * reasonable place to want that.
 */
export function CatalogResyncButton() {
  const { t } = useTranslation("menu");
  const mutation = useResyncCatalogMutation();

  function handleClick() {
    mutation.mutate(undefined, {
      onSuccess: (response: CatalogSyncResponse) => {
        toast.add({
          title: t("resyncSuccessTitle"),
          description: t("resyncSuccessDescription", {
            created: response.created,
            linked: response.linked,
            updated: response.updated,
          }),
        });
      },
      onError: (error: unknown) => {
        if (error instanceof FetchJsonError && error.status === 409) {
          toast.add({ title: t("resyncInProgress") });
          return;
        }
        if (error instanceof FetchJsonError && error.status === 503) {
          toast.add({ title: t("resyncNotConfigured") });
          return;
        }
        toast.add({
          title: t("resyncFailedTitle"),
          description: error instanceof Error ? error.message : undefined,
        });
      },
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={mutation.isPending} onClick={handleClick}>
      {mutation.isPending ? t("resyncButtonPending") : t("resyncButton")}
    </Button>
  );
}
