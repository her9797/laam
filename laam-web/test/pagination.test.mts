import assert from "node:assert/strict";
import test from "node:test";

import { paginateItems } from "../lib/pagination.ts";

test("메뉴를 페이지당 5개로 나누고 현재 페이지 범위를 보정한다", () => {
  const items = Array.from({ length: 12 }, (_, index) => index + 1);

  assert.deepEqual(paginateItems(items, 2, 5), {
    items: [6, 7, 8, 9, 10],
    page: 2,
    pageCount: 3,
    total: 12,
  });

  assert.deepEqual(paginateItems(items, 99, 5), {
    items: [11, 12],
    page: 3,
    pageCount: 3,
    total: 12,
  });
});
