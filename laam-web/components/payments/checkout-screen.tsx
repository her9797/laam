"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { getPaymentOrder, type PaymentOrder } from "@/services/payment-service";

type PaymentWidgets = {
  setAmount(input: { currency: "KRW"; value: number }): Promise<void>;
  renderPaymentMethods(input: { selector: string; variantKey: string }): Promise<void>;
  renderAgreement(input: { selector: string; variantKey: string }): Promise<void>;
  requestPayment(input: {
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
  }): Promise<void>;
};

type TossPaymentsFactory = {
  (clientKey: string): {
    widgets(input: { customerKey: string }): PaymentWidgets;
  };
  ANONYMOUS: string;
};

declare global {
  interface Window {
    TossPayments?: TossPaymentsFactory;
  }
}

export function CheckoutScreen({ orderId, clientKey }: { orderId: string; clientKey: string }) {
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [widgets, setWidgets] = useState<PaymentWidgets | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const renderedOrderRef = useRef("");

  useEffect(() => {
    getPaymentOrder(orderId)
      .then((result) => {
        if (result.status === "DONE") {
          window.location.replace(`/payments/success?paymentKey=${encodeURIComponent(result.paymentKey || "")}&orderId=${encodeURIComponent(result.orderId)}&amount=${result.amount}`);
          return;
        }
        setOrder(result);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "주문을 불러오지 못했습니다."));
  }, [orderId]);

  useEffect(() => {
    if (!scriptReady || !order || !clientKey || !window.TossPayments || renderedOrderRef.current === order.orderId) {
      return;
    }

    const paymentOrder = order;
    let cancelled = false;
    async function renderWidgets() {
      try {
        const TossPayments = window.TossPayments as TossPaymentsFactory;
        const paymentWidgets = TossPayments(clientKey).widgets({ customerKey: TossPayments.ANONYMOUS });
        await paymentWidgets.setAmount({ currency: "KRW", value: paymentOrder.amount });
        if (cancelled) return;
        await paymentWidgets.renderPaymentMethods({ selector: "#payment-method", variantKey: "DEFAULT" });
        await paymentWidgets.renderAgreement({ selector: "#agreement", variantKey: "AGREEMENT" });
        if (cancelled) return;
        renderedOrderRef.current = paymentOrder.orderId;
        setWidgets(paymentWidgets);
      } catch {
        if (!cancelled) setError("결제창을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    }
    void renderWidgets();
    return () => {
      cancelled = true;
    };
  }, [clientKey, order, scriptReady]);

  async function requestPayment() {
    if (!order || !widgets) return;
    setIsRequesting(true);
    setError("");
    try {
      await widgets.requestPayment({
        orderId: order.orderId,
        orderName: order.menuItemName,
        successUrl: `${window.location.origin}/payments/success`,
        failUrl: `${window.location.origin}/payments/fail`,
      });
    } catch {
      setError("결제창을 열지 못했습니다. 다시 시도해 주세요.");
      setIsRequesting(false);
    }
  }

  return (
    <main className="page-shell payment-page">
      <Script
        src="https://js.tosspayments.com/v2/standard"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setError("토스 결제 모듈을 불러오지 못했습니다.")}
      />
      <section className="phone-frame payment-frame">
        <div className="content-card payment-card">
          <p className="section-kicker">payment</p>
          <h1>주문 결제</h1>
          {order ? (
            <div className="payment-summary">
              <div>
                <span>메뉴</span>
                <strong>{order.menuItemName}</strong>
              </div>
              {order.tableNumber ? (
                <div>
                  <span>테이블</span>
                  <strong>{order.tableNumber}</strong>
                </div>
              ) : null}
              <div>
                <span>결제 금액</span>
                <strong>{order.amount.toLocaleString("ko-KR")}원</strong>
              </div>
            </div>
          ) : null}
          {!clientKey ? <p className="payment-error">토스 결제 클라이언트 키가 설정되지 않았습니다.</p> : null}
          {error ? <p className="payment-error">{error}</p> : null}
          <div id="payment-method" className="payment-widget-slot" />
          <div id="agreement" className="payment-widget-slot" />
          <button
            type="button"
            className="request-compose-button payment-submit"
            disabled={!widgets || isRequesting}
            onClick={requestPayment}
          >
            {isRequesting ? "결제창 여는 중..." : order ? `${order.amount.toLocaleString("ko-KR")}원 결제하기` : "결제 준비 중..."}
          </button>
          <Link className="payment-back-link" href="/menu">메뉴로 돌아가기</Link>
        </div>
      </section>
    </main>
  );
}
