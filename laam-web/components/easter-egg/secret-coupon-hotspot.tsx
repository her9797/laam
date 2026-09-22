"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import confetti from "canvas-confetti";

import { getStoredTableNumber } from "@/lib/table-session";
import { claimSecretCoupon, type SecretCouponClaim } from "@/services/secret-coupon-service";

type SecretCouponHotspotProps = {
  couponId: string;
  className: string;
  children: ReactNode;
};

type SecretCouponModalProps = {
  claim: SecretCouponClaim;
  onClose: () => void;
};

export function SecretCouponModal({ claim, onClose }: SecretCouponModalProps) {
  return createPortal(
    <div
      className="table-session-modal-backdrop"
      role="presentation"
    >
      <div
        className="table-session-modal secret-coupon-modal"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          className="secret-coupon-modal-close-x"
          onClick={onClose}
          aria-label="닫기"
        >
          ×
        </button>
        <p className="secret-coupon-modal-title">쉿!크릿 쿠폰</p>
        <p className="secret-coupon-modal-subtitle">이건 우리끼리만! ♥</p>
        <div className="secret-coupon-modal-photo-wrap">
          <span className="secret-coupon-modal-photo-caption-left">쉿... ♥</span>
          <img
            className="secret-coupon-modal-photo"
            src="/secret-coupon/vinyl-laam-shh.jpg"
            alt=""
          />
          <span className="secret-coupon-modal-photo-caption-right">비밀이에요 ♥</span>
        </div>
        <div className="secret-coupon-modal-reward-box">
          <p className="secret-coupon-modal-reward-label">♥ 할인내역 ♥</p>
          <p className="secret-coupon-modal-reward">{claim.rewardLabel}</p>
        </div>
        <p className="secret-coupon-modal-guide">
          본 쿠폰을 사장님께 보여주시면 실물과 교환해드립니다.
        </p>
        <button
          className="secret-coupon-modal-confirm"
          type="button"
          onClick={onClose}
        >
          확인
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A hidden coupon hitbox — nothing marks it as interactive. First guest to
 * tap it claims this coupon; every later tap just gets silently ignored
 * (see `claimSecretCoupon`'s `claimed: false` case), so no error or
 * "already found" message ever gives the secret away.
 */
export function SecretCouponHotspot({ couponId, className, children }: SecretCouponHotspotProps) {
  const [claim, setClaim] = useState<SecretCouponClaim | null>(null);

  async function handleClick() {
    try {
      const result = await claimSecretCoupon(couponId, getStoredTableNumber());
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
      <button type="button" className={className} onClick={handleClick}>
        {children}
      </button>
      {claim ? <SecretCouponModal claim={claim} onClose={() => setClaim(null)} /> : null}
    </>
  );
}
