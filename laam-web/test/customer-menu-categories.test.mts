import assert from "node:assert/strict";
import test from "node:test";

import { getCustomerMenuCategories } from "../lib/customer-menu-categories.ts";

test("고객 메뉴 카테고리는 시그니처를 포함한 다섯 개 뱃지를 정해진 순서와 이름으로 표시한다", () => {
  const categories = getCustomerMenuCategories([
    { id: "signature", label: "대표" },
    { id: "food", label: "안주" },
    { id: "highball", label: "하이볼" },
    { id: "whisky", label: "위스키" },
    { id: "wine", label: "와인" },
    { id: "non-alcohol", label: "논알콜" },
  ]);

  assert.deepEqual(
    categories.map(({ id, label }) => ({ id, label })),
    [
      { id: "signature", label: "시그니처" },
      { id: "highball", label: "하이볼" },
      { id: "whisky", label: "위스키" },
      { id: "wine", label: "칵테일" },
      { id: "non-alcohol", label: "논알콜" },
    ],
  );

  assert.deepEqual(getCustomerMenuCategories([{ id: "non", label: "논알콜" }]), []);
});
