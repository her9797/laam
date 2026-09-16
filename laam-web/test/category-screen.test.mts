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
