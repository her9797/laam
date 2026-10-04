import { fetchJson } from "@/lib/api/fetch-json";

import type { SecretCoupon } from "./model";

/** Only the fields present are changed by the server. */
export type SecretCouponPatch = { rewardLabel?: string; hidingNote?: string };

const COUPONS_PATH = "/api/admin/secret-coupons";

export function listSecretCoupons(): Promise<SecretCoupon[]> {
  return fetchJson<SecretCoupon[]>(COUPONS_PATH);
}

export function updateSecretCoupon(id: string, patch: SecretCouponPatch): Promise<SecretCoupon> {
  return fetchJson<SecretCoupon>(`${COUPONS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/**
 * `claimedAt` is the discovery timestamp the screen last saw for this coupon.
 * The server rejects (409) when the current discovery differs, so a stale
 * screen cannot act on a newer discovery.
 */
export function redeemSecretCoupon(id: string, claimedAt: string): Promise<SecretCoupon> {
  return fetchJson<SecretCoupon>(`${COUPONS_PATH}/${id}/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claimedAt }),
  });
}

export function resetSecretCoupon(id: string, claimedAt: string): Promise<SecretCoupon> {
  return fetchJson<SecretCoupon>(`${COUPONS_PATH}/${id}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claimedAt }),
  });
}
