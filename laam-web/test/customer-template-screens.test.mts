import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("레이아웃은 정해진 템플릿을 html data-template에 싣고 미리보기 띠를 미리보기일 때만 보여준다", async () => {
  const layout = await source("app/layout.tsx");
  assert.match(layout, /getCustomerTemplateContext\(\)/);
  assert.match(layout, /data-template=\{template\}/);
  assert.match(layout, /isPreview \? <PreviewBanner/);
  assert.match(layout, /import "\.\/templates\/notebook\.css"/);
  assert.match(layout, /import "\.\/templates\/chalkboard\.css"/);
});

test("홈 화면은 템플릿에 따라 공책·칠판 홈으로 나뉘고 classic은 지금 화면을 그대로 그린다", async () => {
  const home = await source("components/screens/home-screen.tsx");
  assert.match(home, /template === "notebook"[\s\S]*<NotebookHomeScreen/);
  assert.match(home, /template === "chalkboard"[\s\S]*<ChalkboardHomeScreen/);
  assert.match(home, /className="home-vinyl-card"/, "classic 홈 마크업은 남아 있어야 한다");

  const page = await source("app/page.tsx");
  assert.match(page, /template=\{template\}/);
});

for (const path of ["components/templates/notebook-home-screen.tsx", "components/templates/chalkboard-home-screen.tsx"]) {
  test(`${path}: 시크릿 쿠폰 진입점과 테이블 표시(table-badge 쿠폰)를 유지한다`, async () => {
    const screen = await source(path);
    assert.match(screen, /<SecretCouponHotspot couponId="vinyl-laam"/);
    assert.match(screen, /<TableSessionBadge canEdit=\{canEditTable\} \/>/);
  });
}

for (const name of ["notebook", "chalkboard"]) {
  test(`${name}.css: 모든 규칙이 html[data-template="${name}"] 아래에만 걸려 classic 화면에 새지 않는다`, async () => {
    const css = (await source(`app/templates/${name}.css`)).replace(/\/\*[\s\S]*?\*\//g, "");
    const prelude = /(^|})\s*([^{}@]+)\{/g;
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = prelude.exec(css))) {
      const selectors = match[2].trim();
      if (!selectors || /^(from|to|\d+%)/.test(selectors)) {
        continue;
      }
      for (const selector of selectors.split(",")) {
        count += 1;
        assert.ok(
          selector.trim().startsWith(`html[data-template="${name}"]`),
          `범위 밖 선택자: ${selector.trim()}`,
        );
      }
    }
    assert.ok(count > 20, "템플릿 CSS 규칙이 있어야 한다");
  });
}

test("새 템플릿과 미리보기 띠에서 누르는 요소는 44px 이상이다", async () => {
  const notebook = await source("app/templates/notebook.css");
  const chalkboard = await source("app/templates/chalkboard.css");
  const globals = await source("app/globals.css");
  const block = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `${selector} 규칙이 있어야 한다`);
    return css.slice(start, css.indexOf("}", start));
  };
  for (const [css, selector] of [
    [notebook, 'html[data-template="notebook"] .floating-table-badge'],
    [notebook, 'html[data-template="notebook"] .notebook-polaroid-secret'],
    [chalkboard, 'html[data-template="chalkboard"] .floating-table-badge'],
    [globals, ".template-preview-banner a"],
  ] as const) {
    const rule = block(css, selector);
    const size = Number(rule.match(/(?:min-)?height:\s*(\d+)px/)?.[1] ?? 0);
    assert.ok(size >= 44, `${selector}: ${size}px`);
  }
});
