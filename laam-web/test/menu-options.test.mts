import assert from "node:assert/strict";
import test from "node:test";

import { getMenuOrderTotal, validateMenuOptionSelection } from "../lib/menu-options.ts";

const options = [
  {
    id: "size",
    title: "사이즈",
    required: true,
    minChoices: 1,
    maxChoices: 1,
    choices: [
      { id: "regular", title: "레귤러", priceValue: 0, quantityEnabled: false, minQuantity: 1, maxQuantity: 1 },
      { id: "large", title: "라지", priceValue: 1000, quantityEnabled: false, minQuantity: 1, maxQuantity: 1 },
    ],
  },
];

test("필수 옵션과 선택 개수를 검증한다", () => {
  assert.equal(validateMenuOptionSelection(options, {}), "사이즈 옵션을 선택해 주세요.");
  assert.equal(validateMenuOptionSelection(options, { large: 1 }), "");
});

test("선택 옵션의 추가 금액을 주문 합계에 반영한다", () => {
  assert.equal(getMenuOrderTotal(10000, options, { large: 1 }), 11000);
});
