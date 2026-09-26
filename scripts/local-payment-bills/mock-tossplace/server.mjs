#!/usr/bin/env node
// 로컬 전용 TossPlace Open API 목 서버.
//
// laam-api가 웹훅을 처리하면서 호출하는 조회 API 세 개만 흉내 낸다
// (laam-api/internal/tossplace/client.go 참고).
//
//   GET /api-public/openapi/v1/merchants/:merchantId/order/orders/:orderId
//   GET /api-public/openapi/v1/merchants/:merchantId/payment/payments/by-order-id?orderId=
//   GET /api-public/openapi/v1/merchants/:merchantId/payment/payments/:paymentId
//
// 응답은 실제와 같은 {"resultType":"SUCCESS","success":...} 봉투를 쓴다.
// merchantId와 x-access-key/x-secret-key는 어떤 값이든 받는다(값은 로그에
// 남기지 않는다). 상태는 메모리에만 있고 scenarios.json에서 읽는다.
//
// 시나리오 진행용 제어 엔드포인트:
//   GET  /__mock/health
//   GET  /__mock/state                      현재 주문·결제 전체
//   POST /__mock/reset   {"scenario":"a"}   해당 시나리오(생략 시 전체)를 파일 초기값으로 되돌림
//   POST /__mock/state   {"orders":{id:{...}},"payments":{id:{...}}}
//                                           필드 단위 병합. 없는 id는 새로 만든다.
//
// 값이 "now", "now-30m", "now+2h" 같은 문자열이고 키가 "At"으로 끝나면
// 적용 시점 기준 ISO 시각으로 바꾼다.
//
// 사용법: node scripts/local-payment-bills/mock-tossplace/server.mjs [--port 18080]
//         (환경변수 MOCK_TOSSPLACE_PORT도 가능)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scenariosPath = join(scriptDir, "scenarios.json");

function parsePort() {
  const index = process.argv.indexOf("--port");
  const raw = index >= 0 ? process.argv[index + 1] : process.env.MOCK_TOSSPLACE_PORT;
  const port = Number(raw || 18080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`잘못된 포트: ${raw}`);
    process.exit(1);
  }
  return port;
}

function resolveRelativeTimes(value, now = Date.now()) {
  if (Array.isArray(value)) return value.map((item) => resolveRelativeTimes(item, now));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = key.endsWith("At") && typeof inner === "string" ? resolveTime(inner, now) : resolveRelativeTimes(inner, now);
    }
    return out;
  }
  return value;
}

function resolveTime(raw, now) {
  const match = /^now(?:([+-])(\d+)([smh]))?$/.exec(raw.trim());
  if (!match) return raw;
  if (!match[1]) return new Date(now).toISOString();
  const unit = { s: 1000, m: 60_000, h: 3_600_000 }[match[3]];
  const delta = Number(match[2]) * unit * (match[1] === "-" ? -1 : 1);
  return new Date(now + delta).toISOString();
}

function loadScenarios() {
  return JSON.parse(readFileSync(scenariosPath, "utf8")).scenarios;
}

function findScenario(scenarios, name) {
  return scenarios.find((scenario) => scenario.name === name || scenario.name.startsWith(`${name}-`));
}

const state = { orders: new Map(), payments: new Map() };

function resetState(name) {
  const scenarios = loadScenarios();
  const selected = name ? [findScenario(scenarios, name)] : scenarios;
  if (selected.includes(undefined)) {
    throw new Error(`알 수 없는 시나리오: ${name}`);
  }
  for (const scenario of selected) {
    const order = resolveRelativeTimes(scenario.posOrder);
    state.orders.set(order.id, order);
    for (const [id, payment] of state.payments) {
      if (payment.orderId === order.id) state.payments.delete(id);
    }
    for (const payment of scenario.posPayments || []) {
      const resolved = resolveRelativeTimes(payment);
      state.payments.set(resolved.id, resolved);
    }
  }
  return selected.map((scenario) => scenario.name);
}

function patchState(patch) {
  const now = Date.now();
  for (const [id, fields] of Object.entries(patch.orders || {})) {
    state.orders.set(id, { ...(state.orders.get(id) || { id }), ...resolveRelativeTimes(fields, now) });
  }
  for (const [id, fields] of Object.entries(patch.payments || {})) {
    state.payments.set(id, { ...(state.payments.get(id) || { id }), ...resolveRelativeTimes(fields, now) });
  }
}

function send(res, status, body) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(encoded);
  return status;
}

const success = (res, value) => send(res, 200, { resultType: "SUCCESS", success: value });
const failure = (res, status, errorCode, reason) =>
  send(res, status, { resultType: "FAIL", error: { errorCode, reason } });

async function readJSON(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

const merchantPath = /^\/api-public\/openapi\/v1\/merchants\/[^/]+(\/.*)$/;

async function handle(req, res) {
  const url = new URL(req.url, "http://mock.local");

  if (url.pathname === "/__mock/health") return send(res, 200, { status: "ok" });
  if (url.pathname === "/__mock/state" && req.method === "GET") {
    return send(res, 200, { orders: [...state.orders.values()], payments: [...state.payments.values()] });
  }
  if (url.pathname === "/__mock/state" && req.method === "POST") {
    patchState(await readJSON(req));
    return send(res, 200, { status: "ok" });
  }
  if (url.pathname === "/__mock/reset" && req.method === "POST") {
    const body = await readJSON(req);
    try {
      return send(res, 200, { reset: resetState(body.scenario) });
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }

  const match = merchantPath.exec(url.pathname);
  if (!match || req.method !== "GET") {
    return failure(res, 404, "NOT_FOUND", `mock does not serve ${req.method} ${url.pathname}`);
  }
  if (!req.headers["x-access-key"] || !req.headers["x-secret-key"]) {
    return failure(res, 401, "UNAUTHORIZED", "x-access-key/x-secret-key headers are required");
  }

  const path = match[1];
  if (path === "/payment/payments/by-order-id") {
    const orderId = url.searchParams.get("orderId") || "";
    if (!state.orders.has(orderId)) return failure(res, 404, "NOT_FOUND", `order ${orderId} not found`);
    return success(res, [...state.payments.values()].filter((payment) => payment.orderId === orderId));
  }
  if (path.startsWith("/payment/payments/")) {
    const payment = state.payments.get(decodeURIComponent(path.slice("/payment/payments/".length)));
    return payment ? success(res, payment) : failure(res, 404, "NOT_FOUND", "payment not found");
  }
  if (path.startsWith("/order/orders/")) {
    const order = state.orders.get(decodeURIComponent(path.slice("/order/orders/".length)));
    return order ? success(res, order) : failure(res, 404, "NOT_FOUND", "order not found");
  }
  return failure(res, 404, "NOT_FOUND", `mock does not serve ${path}`);
}

const port = parsePort();
const loaded = resetState();
const server = createServer(async (req, res) => {
  let status;
  try {
    status = await handle(req, res);
  } catch (error) {
    status = send(res, 500, { resultType: "FAIL", error: { errorCode: "MOCK_ERROR", reason: error.message } });
  }
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} -> ${status}`);
});
server.listen(port, () => {
  console.log(`mock TossPlace Open API: http://localhost:${port} (시나리오 ${loaded.length}개 로드: ${loaded.join(", ")})`);
});
