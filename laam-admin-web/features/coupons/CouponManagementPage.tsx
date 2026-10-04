"use client";

import "@/i18n/client";

import { RiMapPinLine } from "@remixicon/react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState, ErrorState, LoadingState } from "@/components/states/PageStates";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils";

import type { SecretCouponPatch } from "./api";
import {
  HIDING_NOTE_MAX_LENGTH,
  couponStatus,
  summarizeCoupons,
  validateHidingNote,
  validateRewardLabel,
  type SecretCoupon,
} from "./model";
import {
  useRedeemSecretCouponMutation,
  useResetSecretCouponMutation,
  useSecretCouponsQuery,
  useUpdateSecretCouponMutation,
} from "./queries";

const ACTION_BUTTON_CLASS = "min-h-11 px-4";

export function CouponManagementPage() {
  const { t, i18n } = useTranslation("coupons");
  const couponsQuery = useSecretCouponsQuery();
  const updateMutation = useUpdateSecretCouponMutation();
  const redeemMutation = useRedeemSecretCouponMutation();
  const resetMutation = useResetSecretCouponMutation();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  // Holds a translation KEY (see `validateRewardLabel`), so a language switch
  // re-renders the message too.
  const [errorKey, setErrorKey] = useState<string | undefined>(undefined);
  const [noteErrorKey, setNoteErrorKey] = useState<string | undefined>(undefined);
  const [pendingResetId, setPendingResetId] = useState<string | null>(null);

  if (couponsQuery.isLoading) {
    return <LoadingState label={t("loading")} />;
  }

  if (couponsQuery.isError) {
    return (
      <ErrorState
        title={t("errorTitle")}
        message={couponsQuery.error instanceof Error ? couponsQuery.error.message : undefined}
        onRetry={() => couponsQuery.refetch()}
      />
    );
  }

  const coupons = couponsQuery.data ?? [];
  const summary = summarizeCoupons(coupons);
  const resetTarget = coupons.find((coupon) => coupon.id === pendingResetId) ?? null;

  function startEdit(coupon: SecretCoupon) {
    setEditingId(coupon.id);
    setDraft(coupon.rewardLabel);
    setNoteDraft(coupon.hidingNote);
    setErrorKey(undefined);
    setNoteErrorKey(undefined);
  }

  function cancelEdit() {
    setEditingId(null);
    setErrorKey(undefined);
    setNoteErrorKey(undefined);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>, coupon: SecretCoupon) {
    event.preventDefault();
    const error = validateRewardLabel(draft);
    const noteError = validateHidingNote(noteDraft);
    setErrorKey(error);
    setNoteErrorKey(noteError);
    if (error || noteError) {
      return;
    }
    // Send only the fields that actually changed.
    const patch: SecretCouponPatch = {};
    if (draft.trim() !== coupon.rewardLabel) {
      patch.rewardLabel = draft.trim();
    }
    if (noteDraft.trim() !== coupon.hidingNote) {
      patch.hidingNote = noteDraft.trim();
    }
    if (Object.keys(patch).length === 0) {
      setEditingId(null);
      return;
    }
    updateMutation.mutate({ id: coupon.id, patch }, { onSuccess: () => setEditingId(null) });
  }

  function isPending(mutation: { isPending: boolean; variables: unknown }, id: string): boolean {
    if (!mutation.isPending) {
      return false;
    }
    const variables = mutation.variables as string | { id: string } | undefined;
    return typeof variables === "string" ? variables === id : variables?.id === id;
  }

  function statusText(coupon: SecretCoupon): string {
    const status = couponStatus(coupon);
    if (status === "redeemed" && coupon.redeemedAt) {
      return t("statusRedeemed", { time: formatDateTime(coupon.redeemedAt, i18n.language) });
    }
    if (status === "claimed" && coupon.claimedAt) {
      return t("statusClaimed", {
        table: coupon.tableNumber,
        time: formatDateTime(coupon.claimedAt, i18n.language),
      });
    }
    return t("statusUnclaimed");
  }

  const statusClass = {
    unclaimed: "bg-muted text-muted-foreground",
    claimed: "bg-primary/10 text-primary",
    redeemed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  } as const;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("summary", {
            claimed: summary.claimed,
            total: summary.total,
            redeemed: summary.redeemed,
          })}
        </p>
      </div>

      {coupons.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {coupons.map((coupon) => {
            const status = couponStatus(coupon);
            const isEditing = editingId === coupon.id;
            return (
              <li
                key={coupon.id}
                className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4"
              >
                {isEditing ? (
                  <form
                    className="flex flex-col gap-2"
                    noValidate
                    onSubmit={(event) => handleSubmit(event, coupon)}
                  >
                    <label htmlFor={`coupon-label-${coupon.id}`} className="text-sm font-medium">
                      {t("labelField")}
                    </label>
                    <Input
                      id={`coupon-label-${coupon.id}`}
                      className="min-h-11"
                      value={draft}
                      aria-invalid={errorKey ? true : undefined}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    {errorKey ? (
                      <p role="alert" className="text-sm text-destructive">
                        {t(errorKey)}
                      </p>
                    ) : null}
                    <label
                      htmlFor={`coupon-note-${coupon.id}`}
                      className="mt-1 text-sm font-medium"
                    >
                      {t("hidingNoteField")}
                    </label>
                    <Textarea
                      id={`coupon-note-${coupon.id}`}
                      className="break-words"
                      value={noteDraft}
                      placeholder={t("hidingNotePlaceholder")}
                      aria-invalid={noteErrorKey ? true : undefined}
                      onChange={(event) => setNoteDraft(event.target.value)}
                    />
                    <p className="text-right text-xs text-muted-foreground">
                      {Array.from(noteDraft.trim()).length}/{HIDING_NOTE_MAX_LENGTH}
                    </p>
                    {noteErrorKey ? (
                      <p role="alert" className="text-sm text-destructive">
                        {t(noteErrorKey)}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        className={ACTION_BUTTON_CLASS}
                        disabled={isPending(updateMutation, coupon.id)}
                      >
                        {t("common:save")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className={ACTION_BUTTON_CLASS}
                        onClick={cancelEdit}
                      >
                        {t("common:cancel")}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="min-w-0 break-words text-base font-medium">{coupon.rewardLabel}</p>
                    <div className="flex min-w-0 items-start gap-1.5 text-sm text-muted-foreground">
                      <RiMapPinLine aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <p className="min-w-0 break-words">
                        <span className="sr-only">{t("hidingNoteLabel")}</span>
                        {coupon.hidingNote ? (
                          <span className="whitespace-pre-wrap">{coupon.hidingNote}</span>
                        ) : (
                          <span className="opacity-60">{t("hidingNoteEmpty")}</span>
                        )}
                      </p>
                    </div>
                  </div>
                )}

                <span
                  className={`w-fit max-w-full rounded-full px-3 py-1 text-xs font-medium ${statusClass[status]}`}
                >
                  {statusText(coupon)}
                </span>

                {isEditing ? null : (
                  <div className="flex flex-wrap gap-2">
                    {status === "claimed" ? (
                      <Button
                        type="button"
                        className={ACTION_BUTTON_CLASS}
                        disabled={isPending(redeemMutation, coupon.id)}
                        onClick={() => redeemMutation.mutate(coupon.id)}
                      >
                        {t("redeem")}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      className={ACTION_BUTTON_CLASS}
                      onClick={() => startEdit(coupon)}
                    >
                      {t("editLabel")}
                    </Button>
                    {status !== "unclaimed" ? (
                      <Button
                        type="button"
                        variant="outline"
                        className={ACTION_BUTTON_CLASS}
                        onClick={() => setPendingResetId(coupon.id)}
                      >
                        {t("reset")}
                      </Button>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingResetId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("resetTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("resetWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetMutation.isPending}
              onClick={() => {
                if (resetTarget) {
                  resetMutation.mutate(resetTarget.id, {
                    onSettled: () => setPendingResetId(null),
                  });
                }
              }}
            >
              {t("reset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
