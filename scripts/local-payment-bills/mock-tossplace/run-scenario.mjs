#!/usr/bin/env node
// 로컬 전용: 목 TossPlace 서버(server.mjs)와 로컬 laam-api를 상대로
// scenarios.json의 계산서 시나리오를 실행한다.
//
//   node scripts/local-payment-bills/mock-tossplace/run-scenario.mjs list
//   node scripts/local-payment-bills/mock-tossplace/run-scenario.mjs all
//   node scripts/local-payment-bills/mock-tossplace/run-scenario.mjs a d-mixed
//   node scripts/local-payment-bills/mock-tossplace/run-scenario.mjs reset
//
// 시나리오마다
//   1. 목 서버의 해당 POS 주문·결제를 초기값으로 되돌리고
//   2. 로컬 DB에 웹 주문(payment_orders, id는 mock-*)과 OPEN 계산서를 넣은 뒤
//   3. 서명한 웹훅을 순서대로 laam-api에 보내고
//   4. 결과 계산서·주문·결제를 DB에서 읽어 기대값과 비교한다.
//
// 환경변수 (없으면 laam-api/.env.local → laam-api/.env → .env.local → .env 순으로 찾는다.
// laam-api를 go run으로 띄울 때 읽는 순서와 같다):
//   DATABASE_URL               로컬 Postgres. host가 localhost/127.0.0.1/::1이 아니면 거부한다.
//   TOSS_PLACE_WEBHOOK_SECRET  laam-api에 설정된 웹훅 서명 키(출력하지 않는다).
//   LAAM_API_URL               기본 http://localhost:9090
//   MOCK_TOSSPLACE_URL         기본 http://localhost:18080
//   PG_CONTAINER               psql이 없을 때 docker exec 할 컨테이너. 생략 시 DATABASE_URL의
//                              포트를 publish한 컨테이너, 없으면 laam-postgres-local.
//   ADMIN_API_TOKEN            있으면 GET /api/v1/admin/payment-bills/{id} 결과도 출력한다.

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const scenarios = JSON.parse(readFileSync(join(scriptDir, "scenarios.json"), "utf8")).scenarios;

// ---------- 설정 ----------

function readEnvFiles() {
  const values = {};
  for (const file of ["laam-api/.env.local", "laam-api/.env", ".env.local", ".env"]) {
    const path = join(repoRoot, file);
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim().replace(/^export\s+/, "");
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const key = line.slice(0, line.indexOf("=")).trim();
      let value = line.slice(line.indexOf("=") + 1).trim();
      if (value.length >= 2 && (value[0] === "'" || value[0] === '"') && value.at(-1) === value[0]) {
        value = value.slice(1, -1);
      }
      if (key && value && !(key in values)) values[key] = value;
    }
  }
  return values;
}

const fileEnv = readEnvFiles();
const setting = (key, fallback = "") => process.env[key] || fileEnv[key] || fallback;

const apiURL = setting("LAAM_API_URL", "http://localhost:9090").replace(/\/+$/, "");
const mockURL = setting("MOCK_TOSSPLACE_URL", "http://localhost:18080").replace(/\/+$/, "");

function fail(message) {
  console.error(`오류: ${message}`);
  process.exit(1);
}

function localDatabase() {
  const raw = setting("DATABASE_URL", "postgres://laam:laam@127.0.0.1:5432/laam?sslmode=disable");
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("DATABASE_URL을 해석할 수 없습니다.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    fail(`DATABASE_URL host가 로컬이 아닙니다(host=${host}). 이 스크립트는 로컬 DB에서만 실행합니다.`);
  }
  return {
    host,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

// ---------- DB (psql 또는 docker exec psql) ----------

let psqlRunner;

function commandWorks(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return !result.error && result.status === 0 ? result.stdout : null;
}

function makeRunner() {
  const db = localDatabase();
  const pgEnv = { PGUSER: db.user, PGPASSWORD: db.password, PGDATABASE: db.database, PGCLIENTENCODING: "UTF8" };
  const psqlArgs = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
  if (commandWorks("psql", ["--version"]) !== null) {
    console.log(`DB: psql → ${db.host}:${db.port}/${db.database}`);
    return { command: "psql", args: psqlArgs, env: { ...process.env, ...pgEnv, PGHOST: db.host, PGPORT: db.port } };
  }
  let container = process.env.PG_CONTAINER;
  if (!container) {
    const published = commandWorks("docker", ["ps", "--filter", `publish=${db.port}`, "--format", "{{.Names}}"]);
    if (published === null) fail("psql도 docker도 실행할 수 없습니다.");
    container = published.split(/\r?\n/).find(Boolean) || "laam-postgres-local";
  }
  console.log(`DB: docker exec ${container} psql (host=${db.host}, port=${db.port}, db=${db.database})`);
  // -e NAME(값 없이)은 docker CLI 자신의 환경변수 값을 넘기므로 비밀번호가 argv에 남지 않는다.
  const envFlags = Object.keys(pgEnv).flatMap((key) => ["-e", key]);
  return { command: "docker", args: ["exec", "-i", ...envFlags, container, "psql", ...psqlArgs], env: { ...process.env, ...pgEnv } };
}

function runSQL(sql) {
  psqlRunner ||= makeRunner();
  const result = spawnSync(psqlRunner.command, psqlRunner.args, { input: sql, encoding: "utf8", env: psqlRunner.env });
  if (result.error || result.status !== 0) {
    fail(`SQL 실행 실패: ${(result.stderr || result.error?.message || "").trim()}`);
  }
  return result.stdout.trim();
}

// JSON을 dollar-quote 리터럴로 넘긴다. 값은 json_to_recordset/->>로만 읽으므로
// 문자열을 SQL에 이어 붙이지 않는다.
function jsonLiteral(value) {
  const text = JSON.stringify(value);
  if (text.includes("$mockjson$")) fail("입력에 허용되지 않는 문자열이 있습니다.");
  return `$mockjson$${text}$mockjson$::json`;
}

function queryJSON(sql, params) {
  const out = runSQL(`WITH p AS (SELECT ${jsonLiteral(params)} AS v) SELECT COALESCE(json_agg(t), '[]'::json) FROM (${sql}) t;`);
  return JSON.parse(out || "[]");
}

function resolveTime(raw, now = Date.now()) {
  const match = /^now(?:([+-])(\d+)([smh]))?$/.exec(String(raw).trim());
  if (!match) return raw;
  if (!match[1]) return new Date(now).toISOString();
  const unit = { s: 1000, m: 60_000, h: 3_600_000 }[match[3]];
  return new Date(now + Number(match[2]) * unit * (match[1] === "-" ? -1 : 1)).toISOString();
}

const cleanupSQL = (filter) => `
BEGIN;
DELETE FROM pos_bills WHERE pos_order_id IN (SELECT value FROM json_array_elements_text((${filter})->'posOrderIds'));
DELETE FROM payment_orders
 WHERE pos_order_id IN (SELECT value FROM json_array_elements_text((${filter})->'posOrderIds'))
    OR id IN (SELECT value FROM json_array_elements_text((${filter})->'orderIds'));
COMMIT;`;

function resetAll() {
  const out = runSQL(`
BEGIN;
WITH bills AS (DELETE FROM pos_bills WHERE pos_order_id LIKE 'mock-pos-%' RETURNING 1)
SELECT 'pos_bills ' || count(*) FROM bills;
WITH orders AS (DELETE FROM payment_orders WHERE id LIKE 'mock-%' OR pos_order_id LIKE 'mock-pos-%' RETURNING 1)
SELECT 'payment_orders ' || count(*) FROM orders;
COMMIT;`);
  console.log(`삭제: ${out.split(/\r?\n/).filter(Boolean).join(", ")} (pos_payments는 계산서와 함께 삭제)`);
}

function seedScenario(scenario) {
  const filter = jsonLiteral({
    posOrderIds: [scenario.posOrderId],
    orderIds: scenario.webOrders.map((order) => order.id),
  });
  runSQL(cleanupSQL(filter));

  const now = Date.now();
  const rows = scenario.webOrders.map((order) => ({
    id: order.id,
    menu_item_name: order.menuItemName,
    category_name: order.categoryName,
    table_number: order.tableNumber,
    amount: order.amount,
    created_at: resolveTime(order.createdAt || "now", now),
    pos_order_id: scenario.posOrderId,
  }));
  // payment_orders 기본값을 따르고, 웹 주문이 POS로 전달된 뒤의 상태
  // (READY, pos_sync_status SUCCEEDED, pos_order_id 설정)만 채운다. 계산서는
  // EnsurePOSBill과 같은 규칙(첫 주문의 테이블, 가장 이른 주문 시각)으로 OPEN 생성.
  runSQL(`
BEGIN;
INSERT INTO payment_orders (id, menu_item_name, category_name, table_number, amount, status, pos_sync_status, pos_order_id, created_at, updated_at)
SELECT r.id, r.menu_item_name, r.category_name, r.table_number, r.amount, 'READY', 'SUCCEEDED', r.pos_order_id, r.created_at, r.created_at
FROM json_to_recordset(${jsonLiteral(rows)}) AS r(id text, menu_item_name text, category_name text, table_number text, amount bigint, created_at timestamptz, pos_order_id text);
INSERT INTO pos_bills (id, pos_order_id, table_number, opened_at)
SELECT 'mock-bill-' || o.pos_order_id, o.pos_order_id,
       (array_agg(o.table_number ORDER BY o.created_at, o.id))[1], MIN(o.created_at)
FROM payment_orders o WHERE o.pos_order_id = (${jsonLiteral({ id: scenario.posOrderId })})->>'id'
GROUP BY o.pos_order_id;
UPDATE payment_orders SET bill_id = 'mock-bill-' || pos_order_id WHERE pos_order_id = (${jsonLiteral({ id: scenario.posOrderId })})->>'id';
COMMIT;`);
}

function readResult(posOrderId) {
  const params = { pos: posOrderId };
  const [bill] = queryJSON(
    `SELECT id, status, table_number, total_amount, payments_synced_at IS NOT NULL AS synced,
            to_char(opened_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS opened_kst
     FROM pos_bills, p WHERE pos_order_id = p.v->>'pos'`,
    params,
  );
  const orders = queryJSON(
    `SELECT id, menu_item_name, amount, status, table_number, payment_method, bill_id IS NOT NULL AS linked
     FROM payment_orders, p WHERE pos_order_id = p.v->>'pos' ORDER BY created_at, id`,
    params,
  );
  const payments = queryJSON(
    `SELECT pp.id, pp.state, pp.source_type, pp.payment_method, pp.card_brand, pp.amount
     FROM pos_payments pp JOIN pos_bills b ON b.id = pp.bill_id, p
     WHERE b.pos_order_id = p.v->>'pos' ORDER BY pp.id`,
    params,
  );
  return { bill, orders, payments };
}

function checkExpectations(expect, { bill, orders, payments }) {
  const problems = [];
  const same = (label, actual, wanted) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) problems.push(`${label}: ${JSON.stringify(actual)} (기대 ${JSON.stringify(wanted)})`);
  };
  if (!bill) return ["계산서가 없습니다"];
  same("bill.status", bill.status, expect.billStatus);
  same("bill.total_amount", bill.total_amount, expect.totalAmount);
  same("bill.synced", bill.synced, expect.synced);
  const counts = {};
  for (const order of orders) counts[order.status] = (counts[order.status] || 0) + 1;
  same("주문 상태별 개수", counts, expect.orders);
  const natives = orders.filter((order) => !order.id.startsWith("mock-"));
  same("POS 직접 입력 행 수", natives.length, expect.nativeRows);
  if (expect.native && natives[0]) {
    same("POS 직접 입력 행", { menuItemName: natives[0].menu_item_name, amount: natives[0].amount }, expect.native);
  }
  same("모든 주문이 계산서에 연결", orders.every((order) => order.linked), true);
  const summary = Object.fromEntries(payments.map((p) => [p.id, `${p.state}/${p.source_type}/${p.amount}`]));
  same("결제", summary, expect.payments);
  return problems;
}

// ---------- HTTP ----------

async function mockRequest(method, path, body) {
  // 목 서버는 키 값을 검사하지 않고 헤더 존재만 확인한다. 실제 키를 보내지 않는다.
  const headers = { "x-access-key": "mock", "x-secret-key": "mock" };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(mockURL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`목 서버 ${method} ${path} -> ${response.status} ${JSON.stringify(json)}`);
  return json;
}

// laam-api가 쓰는 것과 같은 Open API 경로로 목 서버의 현재 값을 읽는다.
async function mockOpenAPI(path) {
  const json = await mockRequest("GET", `/api-public/openapi/v1/merchants/mock-merchant${path}`);
  return json.success;
}

const eventTypes = {
  "order.completed": "order.order.completed.v1",
  "order.cancelled": "order.order.cancelled.v1",
  "payment.approved": "payment.payment.approved.v1",
  "payment.cancelled": "payment.payment.cancelled.v1",
};

let eventSeq = 0;

async function buildEvent(scenario, step) {
  const type = eventTypes[step.webhook];
  if (!type) throw new Error(`알 수 없는 webhook: ${step.webhook}`);
  const envelope = { id: `mock-evt-${Date.now()}-${++eventSeq}`, type, createdAt: new Date().toISOString() };
  if (step.webhook.startsWith("order.")) {
    const order = await mockOpenAPI(`/order/orders/${encodeURIComponent(scenario.posOrderId)}`);
    envelope.data = {
      orderId: order.id,
      orderKey: order.orderKey,
      orderNumber: order.orderNumber || "",
      source: order.source || "POS",
      completedAt: order.completedAt || "",
      cancelledAt: order.cancelledAt || "",
    };
  } else {
    envelope.data = { payment: await mockOpenAPI(`/payment/payments/${encodeURIComponent(step.paymentId)}`) };
  }
  return envelope;
}

async function sendWebhook(secret, envelope) {
  const body = JSON.stringify(envelope);
  const timestamp = String(Date.now());
  const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
  const response = await fetch(`${apiURL}/api/v1/webhooks/tossplace/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-toss-timestamp": timestamp, "x-toss-signature": signature },
    body,
  });
  return { status: response.status, text: (await response.text()).trim() };
}

async function adminBill(billId) {
  const token = setting("ADMIN_API_TOKEN");
  if (!token || !billId) return null;
  const response = await fetch(`${apiURL}/api/v1/admin/payment-bills/${encodeURIComponent(billId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return { error: response.status };
  const bill = await response.json();
  return {
    status: bill.status,
    totalAmount: bill.totalAmount,
    paidAmount: bill.paidAmount,
    menuItems: bill.menuItems?.length,
    payments: bill.payments?.map((p) => `${p.state}/${p.sourceType}/${p.amount}`),
  };
}

// ---------- 실행 ----------

function selectScenarios(names) {
  if (names.includes("all")) return scenarios;
  return names.map((name) => {
    const scenario = scenarios.find((s) => s.name === name || s.name.startsWith(`${name}-`));
    if (!scenario) fail(`알 수 없는 시나리오: ${name} (list로 목록 확인)`);
    return scenario;
  });
}

async function runScenario(scenario, secret) {
  console.log(`\n=== ${scenario.name}: ${scenario.title}`);
  await mockRequest("POST", "/__mock/reset", { scenario: scenario.name });
  seedScenario(scenario);
  console.log(`  웹 주문 ${scenario.webOrders.length}건과 OPEN 계산서 mock-bill-${scenario.posOrderId} 생성`);

  for (const step of scenario.steps) {
    if (step.mock) {
      await mockRequest("POST", "/__mock/state", step.mock);
      console.log(`  [mock] ${step.note || "POS 상태 변경"}`);
      continue;
    }
    const envelope = await buildEvent(scenario, step);
    const result = await sendWebhook(secret, envelope);
    const label = step.paymentId ? `${envelope.type} (${step.paymentId})` : envelope.type;
    console.log(`  [webhook] ${label} -> ${result.status}${step.note ? `  # ${step.note}` : ""}`);
    if (result.status !== 200) throw new Error(`웹훅 실패: ${result.status} ${result.text}`);
  }

  const outcome = readResult(scenario.posOrderId);
  const { bill, orders, payments } = outcome;
  if (bill) {
    console.log(`  계산서 ${bill.id}: ${bill.status}, 테이블 ${bill.table_number}, 청구 ${bill.total_amount ?? "-"}원, 결제목록 동기화=${bill.synced}, 오픈 ${bill.opened_kst} KST`);
  }
  for (const order of orders) {
    const kind = order.id.startsWith("mock-") ? "웹" : "POS";
    console.log(`    주문[${kind}] ${order.id}  ${order.menu_item_name} ${order.amount}원  ${order.status}`);
  }
  for (const payment of payments) {
    console.log(`    결제 ${payment.id}  ${payment.state} ${payment.source_type}(${payment.payment_method}${payment.card_brand ? `/${payment.card_brand}` : ""}) ${payment.amount}원`);
  }
  const admin = await adminBill(bill?.id);
  if (admin) console.log(`  관리자 API: ${JSON.stringify(admin)}`);

  const problems = checkExpectations(scenario.expect, outcome);
  if (problems.length === 0) {
    console.log("  결과: PASS");
    return true;
  }
  console.log("  결과: FAIL");
  for (const problem of problems) console.log(`    - ${problem}`);
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log("사용법: run-scenario.mjs <list|all|reset|시나리오...>  (예: all, a, d-mixed)");
    process.exit(args.length === 0 ? 1 : 0);
  }
  if (args[0] === "list") {
    for (const scenario of scenarios) console.log(`${scenario.name.padEnd(12)} ${scenario.title}`);
    return;
  }
  if (args[0] === "reset") {
    resetAll();
    return;
  }

  const selected = selectScenarios(args);
  const secret = setting("TOSS_PLACE_WEBHOOK_SECRET");
  if (!secret) fail("TOSS_PLACE_WEBHOOK_SECRET이 없습니다. laam-api에 설정한 값과 같은 값을 환경변수로 넘기세요.");
  try {
    await mockRequest("GET", "/__mock/health");
  } catch (error) {
    fail(`목 TossPlace 서버(${mockURL})에 연결할 수 없습니다. server.mjs를 먼저 실행하세요. (${error.cause?.code || error.message})`);
  }
  console.log(`API: ${apiURL}, 목 TossPlace: ${mockURL}`);

  let passed = 0;
  for (const scenario of selected) {
    if (await runScenario(scenario, secret)) passed++;
  }
  console.log(`\n${passed}/${selected.length} 시나리오 PASS`);
  process.exit(passed === selected.length ? 0 : 1);
}

main().catch((error) => fail(error.cause?.code ? `${error.message} (${error.cause.code})` : error.message));
