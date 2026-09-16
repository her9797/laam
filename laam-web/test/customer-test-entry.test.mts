import assert from "node:assert/strict";
import test from "node:test";

import {
  isCustomerTestEntryTokenValid,
  normalizeCustomerTestTable,
} from "../lib/customer-test-entry.ts";

test("테스트 입장 토큰은 설정된 값과 정확히 일치할 때만 유효하다", () => {
  assert.equal(isCustomerTestEntryTokenValid("test-secret", "test-secret"), true);
  assert.equal(isCustomerTestEntryTokenValid("test-secret", "wrong-secret"), false);
  assert.equal(isCustomerTestEntryTokenValid("", "test-secret"), false);
  assert.equal(isCustomerTestEntryTokenValid("test-secret", null), false);
});

test("테스트 테이블 번호는 QR 진입과 같은 범위로 정규화한다", () => {
  assert.equal(normalizeCustomerTestTable("t-1"), "T-01");
  assert.equal(normalizeCustomerTestTable(" B-5 "), "B-05");
  assert.equal(normalizeCustomerTestTable("T-12"), "T-12");
  assert.equal(normalizeCustomerTestTable("T-13"), "");
  assert.equal(normalizeCustomerTestTable("B-06"), "");
  assert.equal(normalizeCustomerTestTable(null), "");
});
