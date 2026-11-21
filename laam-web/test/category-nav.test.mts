import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("메뉴 카테고리는 옆으로 밀지 않고 여러 줄로 감싸 한눈에 다 보인다", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const stripRule = styles.match(/\.subcategory-strip\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(stripRule, /flex-wrap:\s*wrap/);
  assert.match(stripRule, /overflow-x:\s*visible/);
  assert.match(stripRule, /justify-content:\s*center/);

  const nav = await readFile(new URL("../components/navigation/category-nav.tsx", import.meta.url), "utf8");
  // 가로 스크롤이 없으니 선택한 카테고리를 옆으로 끌어오는 코드도 필요 없다
  assert.doesNotMatch(nav, /scrollIntoView/);
});

test("카테고리 줄은 스크롤해도 화면 위에 붙지 않고 제자리에 있다", async () => {
  const screen = await readFile(new URL("../components/screens/category-screen.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(screen, /FloatingCategoryNav/);
  assert.match(screen, /<div className="category-nav-shell">\s*<CategoryNav /);

  for (const path of ["../app/globals.css", "../app/templates/notebook.css", "../app/templates/chalkboard.css"]) {
    const css = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(css, /floating-subnav-shell/, path);
    const shellRules = css.match(/\.category-nav-shell[^{]*\{[^}]*\}/g) ?? [];
    for (const rule of shellRules) {
      assert.doesNotMatch(rule, /position:\s*sticky/, path);
    }
  }
});

test("공책·칠판 템플릿도 카테고리를 여러 줄로 감싼다", async () => {
  for (const name of ["notebook", "chalkboard"]) {
    const css = await readFile(new URL(`../app/templates/${name}.css`, import.meta.url), "utf8");
    // 넘칠 때 옆으로 밀기 위한 자동 여백 트릭이 남아 있으면 줄바꿈 시 첫·끝 줄이 어긋난다
    assert.doesNotMatch(css, /\.category-pill:first-child\s*\{[^}]*margin-left:\s*auto/);
    assert.doesNotMatch(css, /\.category-pill:last-child\s*\{[^}]*margin-right:\s*auto/);
  }
});
