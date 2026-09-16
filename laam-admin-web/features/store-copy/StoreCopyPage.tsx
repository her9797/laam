"use client";

import "@/i18n/client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/states/PageStates";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { useBootstrapQuery } from "@/features/bootstrap/queries";

import { useUpdateStoreCopiesMutation, type StoreCopiesInput } from "./api";

// Labels are keys in the `storeCopy` namespace, resolved at render.
const FIELDS: Array<{ key: keyof StoreCopiesInput; labelKey: string }> = [
  { key: "songRequestCopy", labelKey: "fieldSongRequestCopy" },
  { key: "requestCopy", labelKey: "fieldRequestCopy" },
  { key: "eventCopy", labelKey: "fieldEventCopy" },
];

export function StoreCopyPage() {
  const { t } = useTranslation("storeCopy");
  const bootstrapQuery = useBootstrapQuery();
  const updateMutation = useUpdateStoreCopiesMutation();

  // Seeded once from the first loaded bootstrap response only (guarded by
  // `form === null`) — never re-synced from later bootstrap refetches, so a
  // refetch triggered elsewhere (e.g. window refocus) can't clobber
  // whatever the operator is mid-typing here. The only thing that updates
  // this after the initial load is a successful save's own response
  // (`handleSubmit`'s `onSuccess` below); a failed save intentionally does
  // not touch it, per this page's "keep what the operator typed" rule.
  const [form, setForm] = useState<StoreCopiesInput | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Seeding state during render (not in an effect) here is the React-docs
  // "adjust state based on a prop/query change" pattern: the guard
  // (`form === null`) makes this fire at most once — as soon as it runs it
  // flips `form` non-null, so the condition can never be true again for
  // this component instance — rather than an effect's unconditional
  // "runs after every commit that changed a dependency" cascade.
  if (form === null && bootstrapQuery.data) {
    setForm({
      songRequestCopy: bootstrapQuery.data.store.songRequestCopy,
      requestCopy: bootstrapQuery.data.store.requestCopy,
      eventCopy: bootstrapQuery.data.store.eventCopy,
    });
  }

  if (bootstrapQuery.isError) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : undefined}
        onRetry={() => bootstrapQuery.refetch()}
      />
    );
  }

  if (bootstrapQuery.isLoading || form === null) {
    return <LoadingState label={t("loading")} />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) {
      return;
    }

    // Always sends the full three-field payload, even for the two fields
    // the operator didn't touch — `laam-api`'s
    // `PATCH /api/v1/admin/store-profile` has no partial-update support.
    // If any field is empty, the server rejects the entire request with 400
    // Bad Request, so all three must be sent together to avoid rejection.
    updateMutation.mutate(
      { songRequestCopy: form.songRequestCopy, requestCopy: form.requestCopy, eventCopy: form.eventCopy },
      {
        onSuccess: (appData) => {
          setForm({
            songRequestCopy: appData.store.songRequestCopy,
            requestCopy: appData.store.requestCopy,
            eventCopy: appData.store.eventCopy,
          });
          setStatusMessage(t("saved"));
        },
        // Deliberately no onError handler: a failed save must leave the
        // textareas exactly as the operator typed them, not revert to the
        // last-loaded server values.
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>

      {statusMessage ? (
        <p role="status" aria-live="polite" className="text-sm text-emerald-600 dark:text-emerald-400">
          {statusMessage}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            {FIELDS.map((field) => (
              <div key={field.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`store-copy-${field.key}`}>{t(field.labelKey)}</Label>
                <Textarea
                  id={`store-copy-${field.key}`}
                  value={form[field.key]}
                  onChange={(event) =>
                    setForm((current) =>
                      current ? { ...current, [field.key]: event.target.value } : current,
                    )
                  }
                />
              </div>
            ))}

            {updateMutation.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {updateMutation.error instanceof Error
                  ? updateMutation.error.message
                  : t("saveFailed")}
              </p>
            ) : null}

            <Button type="submit" disabled={updateMutation.isPending}>
              {t("common:save")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
