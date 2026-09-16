import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("매장 주문 등록은 POS 동기화가 진행 중(PENDING)이어도 실패로 처리하지 않는다", async () => {
  const source = await readFile(new URL("../services/order-service.ts", import.meta.url), "utf8");

  assert.match(source, /posSyncStatus === "FAILED"/);
  assert.doesNotMatch(source, /posSyncStatus !== "SUCCEEDED"/);
});
