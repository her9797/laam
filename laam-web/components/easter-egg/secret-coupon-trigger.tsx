"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import confetti from "canvas-confetti";

import { getStoredTableNumber } from "@/lib/table-session";
import { claimSecretCoupon, type SecretCouponClaim } from "@/services/secret-coupon-service";

/**
 * The vinyl record's "laam" center label doubles as a hidden coupon
 * trigger — nothing on screen marks it as interactive. First guest to tap
 * it claims this coupon; every later tap just gets silently ignored (see
 * `claimSecretCoupon`'s `claimed: false` case), so no error or "already
 * found" message ever gives the secret away.
 */
export function SecretCouponTrigger() {
  const [claim, setClaim] = useState<SecretCouponClaim | null>(null);

  async function handleClick() {
    try {
      const result = await claimSecretCoupon("vinyl-laam", getStoredTableNumber());
      if (!result.claimed) {
        return;
      }
      setClaim(result.claim);
      confetti({
        particleCount: 140,
        spread: 90,
        origin: { y: 0.6 },
      });
    } catch {
      // Silent by design — see the doc comment above.
    }
  }

  return (
    <>
      <button
        type="button"
        className="home-vinyl-secret"
        onClick={handleClick}
      >
        laam
      </button>
      {claim ? createPortal(
        <div
          className="table-session-modal-backdrop"
          role="presentation"
          onClick={() => setClaim(null)}
        >
          <div
            className="table-session-modal secret-coupon-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="secret-coupon-modal-kicker">쉿크릿 쿠폰</p>
            <h2>축하합니다!</h2>
            <p className="secret-coupon-modal-reward">{claim.rewardLabel}</p>
            <p className="secret-coupon-modal-progress">
              {claim.claimedCount}/{claim.totalCount} 발견
            </p>
            <p className="secret-coupon-modal-guide">
              이 화면을 직원에게 보여주시면 쿠폰으로 교환해드려요.
            </p>
            <button
              className="table-session-modal-close"
              type="button"
              onClick={() => setClaim(null)}
            >
              닫기
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
