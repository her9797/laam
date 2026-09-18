import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("메뉴 주문은 결제 화면 없이 토스 POS 주문을 등록하고 완료를 표시한다", async () => {
  const card = await readFile(
    new URL("../components/menu/menu-item-card.tsx", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL("../services/order-service.ts", import.meta.url),
    "utf8",
  );

  assert.match(card, /createOrder/);
  assert.match(card, /요청사항/);
  assert.match(card, /maxLength=\{200\}/);
  assert.match(card, /requestNote/);
  assert.match(card, /optionChoices/);
  assert.match(card, /validateMenuOptionSelection/);
  assert.match(card, /주문이 접수됐어요/);
  assert.doesNotMatch(card, /\/checkout/);
  assert.match(service, /fetch\("\/api\/orders"/);
  assert.match(service, /requestNote/);
  assert.match(service, /optionChoices/);
});

test("주문 버튼을 누르면 바로 접수하지 않고 확인 절차를 먼저 거친다", async () => {
  const card = await readFile(
    new URL("../components/menu/menu-item-card.tsx", import.meta.url),
    "utf8",
  );

  const orderButtonIndex = card.indexOf('onClick={requestOrderConfirmation}');
  const submitFnIndex = card.indexOf("function submitOrder()");
  const createOrderIndex = card.indexOf("await createOrder(");
  const confirmPromptIndex = card.indexOf("정말 주문하시겠어요?");
  const confirmButtonIndex = card.indexOf('onClick={submitOrder}');
  const cancelButtonIndex = card.indexOf("onClick={() => setIsConfirmingOrder(false)}");

  assert.ok(orderButtonIndex >= 0, "주문 버튼은 확인 요청 핸들러를 호출해야 한다");
  assert.ok(submitFnIndex >= 0, "실제 주문 접수는 별도 함수여야 한다");
  assert.ok(createOrderIndex > submitFnIndex, "createOrder 호출은 submitOrder 함수 안에 있어야 한다");
  assert.ok(confirmPromptIndex >= 0, "확인 문구가 있어야 한다");
  assert.ok(confirmButtonIndex > confirmPromptIndex, "확인 버튼은 submitOrder를 직접 호출해야 한다");
  assert.ok(cancelButtonIndex > confirmPromptIndex, "취소 버튼이 있어야 한다");
});

test("결제 API 프록시는 QR 세션과 서버 전용 토큰을 확인한다", async () => {
  const source = await readFile(
    new URL("../app/api/payments/orders/route.ts", import.meta.url),
    "utf8",
  );
  const helper = await readFile(
    new URL("../lib/payment-api-server.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /hasPaymentSession/);
  assert.match(helper, /isQrSessionValid/);
  assert.match(helper, /PAYMENT_API_TOKEN/);
  assert.doesNotMatch(helper, /NEXT_PUBLIC_PAYMENT_API_TOKEN/);
});

test("주문 API 프록시는 QR 세션과 서버 전용 토큰을 확인한다", async () => {
  const source = await readFile(
    new URL("../app/api/orders/route.ts", import.meta.url),
    "utf8",
  );
  const helper = await readFile(
    new URL("../lib/payment-api-server.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /hasPaymentSession/);
  assert.match(source, /\/api\/v1\/orders/);
  assert.match(helper, /PAYMENT_API_TOKEN/);
});

test("시크릿 쿠폰 claim API 프록시는 QR 세션을 확인하고 id를 그대로 전달한다", async () => {
  const source = await readFile(
    new URL("../app/api/secret-coupons/[id]/claim/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /hasPaymentSession/);
  assert.match(source, /\/api\/v1\/secret-coupons\/\$\{encodeURIComponent\(id\)\}\/claim/);
});
