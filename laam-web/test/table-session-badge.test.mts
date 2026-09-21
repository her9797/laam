import assert from "node:assert/strict";
import test from "node:test";

import { formatTableLabel } from "../lib/table-label.ts";

test("테이블 배지는 QR 코드를 그대로 보여 준다", () => {
  assert.equal(formatTableLabel("T-01"), "T-01");
  assert.equal(formatTableLabel("b-3"), "B-03");
  assert.equal(formatTableLabel(""), "TABLE");

  // POS에서 온 테이블의 코드는 관리자가 정한다. T/B가 아닌 구역 문자도
  // 그대로 보여야 한다. 예전에는 "R-02"가 "T-R-02"로 찍혔다.
  assert.equal(formatTableLabel("R-02"), "R-02");
  assert.equal(formatTableLabel("r-2"), "R-02");

  // 숫자만 저장된 옛 값은 지금처럼 일반 테이블로 읽는다.
  assert.equal(formatTableLabel("7"), "T-07");
});
