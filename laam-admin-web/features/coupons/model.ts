/** Mirrors the `laam-api` secret coupon object (`/api/v1/admin/secret-coupons`). */
export type SecretCoupon = {
  id: string;
  rewardLabel: string;
  /** Where/how the coupon is hidden; `""` when there is no note. */
  hidingNote: string;
  sortOrder: number;
  /** RFC3339 UTC; `null` while no table has found the coupon. */
  claimedAt: string | null;
  /** Table that found the coupon; `""` while unclaimed. */
  tableNumber: string;
  /** When the operator handed over the reward; `null` until then. */
  redeemedAt: string | null;
};

export type SecretCouponStatus = "unclaimed" | "claimed" | "redeemed";

export const REWARD_LABEL_MAX_LENGTH = 40;
export const HIDING_NOTE_MAX_LENGTH = 200;

export function couponStatus(coupon: SecretCoupon): SecretCouponStatus {
  if (coupon.redeemedAt) {
    return "redeemed";
  }
  return coupon.claimedAt ? "claimed" : "unclaimed";
}

export function summarizeCoupons(coupons: SecretCoupon[]): {
  total: number;
  claimed: number;
  redeemed: number;
} {
  return {
    total: coupons.length,
    claimed: coupons.filter((coupon) => coupon.claimedAt !== null).length,
    redeemed: coupons.filter((coupon) => coupon.redeemedAt !== null).length,
  };
}

export type RewardLabelValidationKey = "errorLabelRequired" | "errorLabelTooLong";

/**
 * Same rule as `laam-api` (trimmed, 1 to 40 characters). Returns a key in the
 * `coupons` namespace so the caller renders it in the operator's language.
 */
export function validateRewardLabel(label: string): RewardLabelValidationKey | undefined {
  const trimmed = label.trim();
  if (!trimmed) {
    return "errorLabelRequired";
  }
  if (Array.from(trimmed).length > REWARD_LABEL_MAX_LENGTH) {
    return "errorLabelTooLong";
  }
  return undefined;
}

export type HidingNoteValidationKey = "errorHidingNoteTooLong";

/** Same rule as `laam-api` (trimmed, 0 to 200 characters; blank is allowed). */
export function validateHidingNote(note: string): HidingNoteValidationKey | undefined {
  if (Array.from(note.trim()).length > HIDING_NOTE_MAX_LENGTH) {
    return "errorHidingNoteTooLong";
  }
  return undefined;
}
