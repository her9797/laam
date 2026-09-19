import { orderErrorMessage, type OrderErrorBody } from "../lib/order-errors.ts";

export type CustomerOrder = {
  orderId: string;
  menuItemId: string;
  menuItemName: string;
  categoryName: string;
  tableNumber: string;
  requestNote: string;
  amount: number;
  status: "READY" | "DONE";
  posSyncStatus: "PENDING" | "SUCCEEDED" | "FAILED" | "NOT_CONFIGURED";
  posOrderId?: string;
  createdAt: string;
};

export type OrderOptionChoiceInput = {
  optionId: string;
  optionChoiceId: string;
  quantity: number;
};

export async function createOrder(input: { menuItemId: string; tableNumber: string; requestNote: string; optionChoices: OrderOptionChoiceInput[] }) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = (await response.json().catch(() => null)) as CustomerOrder | OrderErrorBody;
  if (!response.ok) {
    throw new Error(orderErrorMessage(body as OrderErrorBody, "주문을 등록하지 못했습니다."));
  }

  const order = body as CustomerOrder;
  if (order.posSyncStatus === "FAILED") {
    throw new Error("매장 주문 등록에 실패했습니다. 직원에게 직접 말씀해 주세요.");
  }
  return order;
}
