import assert from "node:assert/strict";
import test from "node:test";

import { getMenuItemDetail } from "../lib/menu-item-detail.ts";

test("메뉴 상세 모달에 메뉴명, 금액, 설명을 전달한다", () => {
  assert.deepEqual(
    getMenuItemDetail({
      id: "highball",
      categoryId: "highball",
      name: "하우스 하이볼",
      price: "9,000원",
      description: "레몬 향을 더한 드라이한 밸런스",
    }),
    {
      name: "하우스 하이볼",
      price: "9,000원",
      description: "레몬 향을 더한 드라이한 밸런스",
    },
  );
});
