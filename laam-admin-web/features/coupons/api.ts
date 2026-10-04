import { fetchJson } from "@/lib/api/fetch-json";

import type { SecretCoupon } from "./model";

const COUPONS_PATH = "/api/admin/secret-coupons";

export function listSecretCoupons(): Promise<SecretCoupon[]> {
  return fetchJson<SecretCoupon[]>(COUPONS_PATH);
}

export function updateSecretCouponLabel(id: string, rewardLabel: string): Promise<SecretCoupon> {
  return fetchJson<SecretCoupon>(`${COUPONS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rewardLabel }),
  });
}

export function redeemSecretCoupon(id: string): Promise<SecretCoupon> {
  return fetchJson<SecretCoupon>(`${COUPONS_PATH}/${id}/redeem`, { method: "POST" });
}

export function resetSecretCoupon(id: string): Promise<SecretCoupon> {
  return fetchJson<SecretCoupon>(`${COUPONS_PATH}/${id}/reset`, { method: "POST" });
}
