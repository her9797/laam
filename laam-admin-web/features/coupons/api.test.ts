import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/fetch-json", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/fetch-json")>(
    "@/lib/api/fetch-json",
  );
  return { ...actual, fetchJson: vi.fn() };
});

import { fetchJson } from "@/lib/api/fetch-json";

import {
  listSecretCoupons,
  redeemSecretCoupon,
  resetSecretCoupon,
  updateSecretCouponLabel,
} from "./api";
import type { SecretCoupon } from "./model";

const COUPON: SecretCoupon = {
  id: "coupon-1",
  rewardLabel: "하이볼 1잔",
  sortOrder: 1,
  claimedAt: null,
  tableNumber: "",
  redeemedAt: null,
};

afterEach(() => {
  vi.mocked(fetchJson).mockReset();
});

describe("secret coupon api", () => {
  it("lists coupons with GET", async () => {
    vi.mocked(fetchJson).mockResolvedValue([COUPON]);

    await expect(listSecretCoupons()).resolves.toEqual([COUPON]);
    expect(fetchJson).toHaveBeenCalledWith("/api/admin/secret-coupons");
  });

  it("updates the reward label with PATCH and a JSON body", async () => {
    vi.mocked(fetchJson).mockResolvedValue({ ...COUPON, rewardLabel: "안주 1개" });

    await updateSecretCouponLabel("coupon-1", "안주 1개");

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/secret-coupons/coupon-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rewardLabel: "안주 1개" }),
    });
  });

  it("redeems with POST", async () => {
    vi.mocked(fetchJson).mockResolvedValue(COUPON);

    await redeemSecretCoupon("coupon-1");

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/secret-coupons/coupon-1/redeem", {
      method: "POST",
    });
  });

  it("resets with POST", async () => {
    vi.mocked(fetchJson).mockResolvedValue(COUPON);

    await resetSecretCoupon("coupon-1");

    expect(fetchJson).toHaveBeenCalledWith("/api/admin/secret-coupons/coupon-1/reset", {
      method: "POST",
    });
  });
});
