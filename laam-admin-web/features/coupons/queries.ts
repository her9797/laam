"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { toast } from "@/components/ui/toast";
import { FetchJsonError } from "@/lib/api/fetch-json";

import {
  listSecretCoupons,
  redeemSecretCoupon,
  resetSecretCoupon,
  updateSecretCoupon,
  type SecretCouponPatch,
} from "./api";

export const couponKeys = {
  all: ["secretCoupons"] as const,
};

export function useSecretCouponsQuery() {
  return useQuery({
    queryKey: couponKeys.all,
    queryFn: listSecretCoupons,
  });
}

/**
 * Shared success/failure handling for the three coupon mutations: a success
 * refreshes the list, a failure shows the server's own message in a toast.
 * Texts are translated when the toast is shown so a language switch mid-request
 * still gets the current language.
 */
function useCouponMutationHandlers(successKey: string, failureKey: string) {
  const queryClient = useQueryClient();
  const { i18n } = useTranslation("coupons");
  return {
    onSuccess: async () => {
      toast.add({ type: "success", title: i18n.t(successKey, { ns: "coupons" }) });
      await queryClient.invalidateQueries({ queryKey: couponKeys.all });
    },
    onError: async (error: unknown) => {
      if (error instanceof FetchJsonError && error.status === 409) {
        // The coupon changed under this screen; reload so the admin sees the truth.
        toast.add({ type: "error", title: i18n.t("conflictRefreshed", { ns: "coupons" }) });
      } else {
        toast.add({
          type: "error",
          title: i18n.t(failureKey, { ns: "coupons" }),
          description: error instanceof Error ? error.message : undefined,
        });
      }
      await queryClient.invalidateQueries({ queryKey: couponKeys.all });
    },
  };
}

export function useUpdateSecretCouponMutation() {
  const handlers = useCouponMutationHandlers("updated", "updateFailed");
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SecretCouponPatch }) =>
      updateSecretCoupon(id, patch),
    ...handlers,
  });
}

export function useRedeemSecretCouponMutation() {
  const handlers = useCouponMutationHandlers("redeemed", "redeemFailed");
  return useMutation({
    mutationFn: ({ id, claimedAt }: { id: string; claimedAt: string }) =>
      redeemSecretCoupon(id, claimedAt),
    ...handlers,
  });
}

export function useResetSecretCouponMutation() {
  const handlers = useCouponMutationHandlers("resetDone", "resetFailed");
  return useMutation({
    mutationFn: ({ id, claimedAt }: { id: string; claimedAt: string }) =>
      resetSecretCoupon(id, claimedAt),
    ...handlers,
  });
}
