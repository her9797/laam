import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("카테고리 화면은 메뉴 목록 위에 카테고리 제목을 반복하지 않는다", async () => {
  const source = await readFile(
    new URL("../components/screens/category-screen.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /<p className="section-kicker">category<\/p>/);
});

test("카테고리 화면은 페이지를 나누지 않고 메뉴 전체를 쭉 보여준다", async () => {
  const source = await readFile(
    new URL("../components/screens/category-screen.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /PaginatedMenuList/);
  assert.match(source, /items\.map\(\(item\) => \(\s*<MenuItemCard key=\{item\.id\} item=\{item\} \/>/);
});
