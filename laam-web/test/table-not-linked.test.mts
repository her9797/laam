import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { createOrder } from "../services/order-service.ts";
import { createPaymentOrder } from "../services/payment-service.ts";

const TABLE_NOT_LINKED_MESSAGE = "이 자리는 아직 준비 중이에요. 직원을 불러 주세요.";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

const ORDER_INPUT = {
  menuItemId: "menu-1",
  tableNumber: "T-01",
  requestNote: "",
  optionChoices: [],
};

test("POS에 연결되지 않은 자리에서 주문하면 준비 중 안내를 보여 준다", async () => {
  stubFetch(400, { error: "table is not linked to POS", code: "table_not_linked" });

  await assert.rejects(createOrder(ORDER_INPUT), { message: TABLE_NOT_LINKED_MESSAGE });
});

test("연결되지 않은 자리 안내는 다른 주문 오류 문구와 구분된다", async () => {
  stubFetch(400, { error: "menu item is sold out" });

  await assert.rejects(createOrder(ORDER_INPUT), (error: Error) => {
    assert.notEqual(error.message, TABLE_NOT_LINKED_MESSAGE);
    assert.equal(error.message, "menu item is sold out");
    return true;
  });
});

test("결제 주문도 연결되지 않은 자리에서는 같은 안내를 보여 준다", async () => {
  stubFetch(400, { error: "table is not linked to POS", code: "table_not_linked" });

  await assert.rejects(createPaymentOrder({ menuItemId: "menu-1", tableNumber: "T-01" }), {
    message: TABLE_NOT_LINKED_MESSAGE,
  });
});

test("결제 주문의 다른 오류는 서버 문구를 그대로 보여 준다", async () => {
  stubFetch(500, { error: "결제 서버 오류" });

  await assert.rejects(createPaymentOrder({ menuItemId: "menu-1", tableNumber: "T-01" }), {
    message: "결제 서버 오류",
  });
});
