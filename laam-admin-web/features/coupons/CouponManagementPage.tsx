"use client";

import "@/i18n/client";

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
import { formatDateTime } from "@/lib/utils";

import { couponStatus, summarizeCoupons, validateRewardLabel, type SecretCoupon } from "./model";
import {
  useRedeemSecretCouponMutation,
  useResetSecretCouponMutation,
  useSecretCouponsQuery,
  useUpdateSecretCouponLabelMutation,
} from "./queries";

const ACTION_BUTTON_CLASS = "min-h-11 px-4";

export function CouponManagementPage() {
  const { t, i18n } = useTranslation("coupons");
  const couponsQuery = useSecretCouponsQuery();
  const updateMutation = useUpdateSecretCouponLabelMutation();
  const redeemMutation = useRedeemSecretCouponMutation();
  const resetMutation = useResetSecretCouponMutation();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Holds a translation KEY (see `validateRewardLabel`), so a language switch
  // re-renders the message too.
  const [errorKey, setErrorKey] = useState<string | undefined>(undefined);
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
    setErrorKey(undefined);
  }

  function cancelEdit() {
    setEditingId(null);
    setErrorKey(undefined);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>, coupon: SecretCoupon) {
    event.preventDefault();
    const error = validateRewardLabel(draft);
    setErrorKey(error);
    if (error) {
      return;
    }
    updateMutation.mutate(
      { id: coupon.id, rewardLabel: draft.trim() },
      { onSuccess: () => setEditingId(null) },
    );
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
                  <p className="min-w-0 break-words text-base font-medium">{coupon.rewardLabel}</p>
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
