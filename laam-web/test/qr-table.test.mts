import assert from "node:assert/strict";
import test from "node:test";

import { normalizeQrTable } from "../lib/qr-table.ts";

test("QR 테이블 번호는 구역 문자와 두 자리 번호 형식으로 정규화한다", () => {
  assert.equal(normalizeQrTable("t-1"), "T-01");
  assert.equal(normalizeQrTable(" B-5 "), "B-05");
  assert.equal(normalizeQrTable("T-12"), "T-12");
});

test("POS에서 추가한 테이블 때문에 번호 상한을 두지 않는다", () => {
  // 예전에는 T는 12번, B는 5번까지만 입장할 수 있었다. 이제 POS 테이블을
  // 그대로 QR 테이블로 추가할 수 있으므로 번호 상한이 없어야 한다.
  assert.equal(normalizeQrTable("T-13"), "T-13");
  assert.equal(normalizeQrTable("T-40"), "T-40");
  assert.equal(normalizeQrTable("B-06"), "B-06");
  assert.equal(normalizeQrTable("B-99"), "B-99");
});

test("구역 문자는 T와 B에 한정하지 않는다", () => {
  assert.equal(normalizeQrTable("r-2"), "R-02");
});

test("형식에 맞지 않으면 빈 문자열을 돌려준다", () => {
  assert.equal(normalizeQrTable("T-0"), "");
  assert.equal(normalizeQrTable("T-00"), "");
  assert.equal(normalizeQrTable("T-100"), "");
  assert.equal(normalizeQrTable("TT-01"), "");
  assert.equal(normalizeQrTable("T01"), "");
  assert.equal(normalizeQrTable("1-01"), "");
  assert.equal(normalizeQrTable(""), "");
  assert.equal(normalizeQrTable(null), "");
});

test("QR 입장 라우트는 서명 검사를 유지한 채 공용 정규화를 쓴다", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/qr/enter/route.ts", import.meta.url), "utf8");

  assert.match(source, /normalizeQrTable/);
  assert.match(source, /isQrTableSignatureValid/);
  assert.doesNotMatch(source, /maxTableNumber/);
});
