"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { confirmPayment, type PaymentOrder } from "@/services/payment-service";

export function PaymentSuccessScreen({
  paymentKey,
  orderId,
  amount,
}: {
  paymentKey: string;
  orderId: string;
  amount: number;
}) {
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    confirmPayment({ paymentKey, orderId, amount })
      .then(setOrder)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "결제 승인을 확인하지 못했습니다."));
  }, [amount, orderId, paymentKey]);

  return (
    <main className="page-shell payment-page">
      <section className="phone-frame payment-frame">
        <div className="content-card payment-card payment-result-card">
          <p className="section-kicker">payment result</p>
          {error ? (
            <>
              <h1>결제 확인이 필요합니다</h1>
              <p className="payment-error">{error}</p>
              <p className="payment-result-copy">결제 내역을 확인한 뒤 직원에게 말씀해 주세요.</p>
            </>
          ) : order ? (
            <>
              <h1>결제가 완료됐어요</h1>
              <p className="payment-result-copy">
                {order.menuItemName} · {order.amount.toLocaleString("ko-KR")}원
              </p>
              {order.posSyncStatus !== "SUCCEEDED" ? (
                <p className="payment-notice">결제는 완료됐으며 매장 주문을 동기화하고 있습니다. 직원에게 화면을 보여주세요.</p>
              ) : null}
            </>
          ) : (
            <>
              <h1>결제를 확인하고 있어요</h1>
              <p className="payment-result-copy">창을 닫지 말고 잠시만 기다려 주세요.</p>
            </>
          )}
          <Link className="request-compose-button payment-result-link" href="/menu">메뉴로 돌아가기</Link>
        </div>
      </section>
    </main>
  );
}
