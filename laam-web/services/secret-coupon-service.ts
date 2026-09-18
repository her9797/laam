export type SecretCouponClaim = {
  rewardLabel: string;
  claimedCount: number;
  totalCount: number;
};

/**
 * Already-claimed (409) is a normal outcome — someone else found this one
 * first — not an error the caller should surface as a failure. `claimed`
 * distinguishes that case from a real request failure so the trigger can
 * stay silent instead of showing a scary error for a coupon that's just
 * gone.
 */
export type ClaimSecretCouponResult =
  | { claimed: true; claim: SecretCouponClaim }
  | { claimed: false };

export async function claimSecretCoupon(
  id: string,
  tableNumber: string,
): Promise<ClaimSecretCouponResult> {
  const response = await fetch(`/api/secret-coupons/${encodeURIComponent(id)}/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tableNumber }),
  });

  if (response.status === 409) {
    return { claimed: false };
  }
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error ?? `request failed: ${response.status}`);
  }

  const claim = (await response.json()) as SecretCouponClaim;
  return { claimed: true, claim };
}
