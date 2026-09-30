import assert from "node:assert/strict";
import test from "node:test";

import { getCustomerMenuCategories } from "../lib/customer-menu-categories.ts";

const item = (categoryId: string, isVisible = true) => ({
  id: `${categoryId}-${isVisible}`,
  categoryId,
  name: "메뉴",
  description: "",
  price: "10,000원",
  isVisible,
});

test("고객 메뉴 카테고리는 POS가 정한 이름과 순서를 그대로 쓴다", () => {
  const categories = getCustomerMenuCategories(
    [
      { id: "1567463", label: "시그니처" },
      { id: "1567288", label: "1%~7%" },
      { id: "1567400", label: "싱글몰트 위스키" },
    ],
    [item("1567463"), item("1567288"), item("1567400")],
  );

  assert.deepEqual(
    categories.map(({ id, label }) => ({ id, label })),
    [
      { id: "1567463", label: "시그니처" },
      { id: "1567288", label: "1%~7%" },
      { id: "1567400", label: "싱글몰트 위스키" },
    ],
  );
});

test("보이는 메뉴가 없는 카테고리는 빈 탭이 되므로 숨긴다", () => {
  const categories = getCustomerMenuCategories(
    [
      { id: "1567463", label: "시그니처" },
      { id: "1659122", label: "인기" },
      { id: "1567288", label: "1%~7%" },
    ],
    [item("1567463"), item("1567288", false)],
  );

  assert.deepEqual(
    categories.map(({ id }) => id),
    ["1567463"],
  );
});

test("숨김 처리된 카테고리는 메뉴가 있어도 제외한다", () => {
  const categories = getCustomerMenuCategories(
    [{ id: "legacy", label: "옛 카테고리", isVisible: false }],
    [item("legacy")],
  );

  assert.deepEqual(categories, []);
});
