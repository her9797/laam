export type PaymentOrder = {
  orderId: string;
  menuItemId: string;
  menuItemName: string;
  categoryName: string;
  tableNumber: string;
  amount: number;
  status: "READY" | "DONE";
  paymentKey?: string;
  paymentMethod?: string;
  approvedAt?: string;
  posSyncStatus: "PENDING" | "SUCCEEDED" | "FAILED" | "NOT_CONFIGURED";
  posOrderId?: string;
  createdAt: string;
};

async function readPaymentResponse(response: Response) {
  if (response.ok) {
    return (await response.json()) as PaymentOrder;
  }

  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error || "결제 요청을 처리하지 못했습니다.");
}

export async function createPaymentOrder(input: { menuItemId: string; tableNumber: string }) {
  const response = await fetch("/api/payments/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readPaymentResponse(response);
}

export async function getPaymentOrder(orderId: string) {
  const response = await fetch(`/api/payments/orders/${encodeURIComponent(orderId)}`, {
    cache: "no-store",
  });
  return readPaymentResponse(response);
}

export async function confirmPayment(input: { paymentKey: string; orderId: string; amount: number }) {
  const response = await fetch("/api/payments/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readPaymentResponse(response);
}
