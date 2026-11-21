import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { splitMenuDescription } from "../lib/menu-description.ts";

test("설명 앞의 #태그를 라벨로 분리하고 나머지 설명만 남긴다", () => {
  assert.deepEqual(splitMenuDescription("#상큼함#과일향\n보드카+오렌지 주스"), {
    tags: ["상큼함", "과일향"],
    body: "보드카+오렌지 주스",
  });
});

test("태그 사이에 공백이 있어도 태그로 분리한다", () => {
  assert.deepEqual(splitMenuDescription("#달콤함 #상큼함\n피치트리+말리부"), {
    tags: ["달콤함", "상큼함"],
    body: "피치트리+말리부",
  });
});

test("태그가 없으면 설명을 그대로 두고, 같은 태그는 한 번만 표시한다", () => {
  assert.deepEqual(splitMenuDescription("깔루아+우유"), { tags: [], body: "깔루아+우유" });
  assert.deepEqual(splitMenuDescription("#달콤함#달콤함\n우유"), { tags: ["달콤함"], body: "우유" });
  assert.deepEqual(splitMenuDescription("#달콤함"), { tags: ["달콤함"], body: "" });
  assert.deepEqual(splitMenuDescription(""), { tags: [], body: "" });
});

test("메뉴 카드와 상세 모달은 #태그를 파스텔 레드 라벨로 표시한다", async () => {
  const card = await readFile(new URL("../components/menu/menu-item-card.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(card, /splitMenuDescription/);
  assert.match(card, /data-label-color="red"/);
  const titleRows = card.match(/className="menu-title-row[^"]*"[\s\S]*?<\/div>\s*\) : null\}/g) ?? [];
  assert.equal(titleRows.length, 2);
  const [listTitleRow, detailTitleRow] = titleRows;
  // 목록에서는 맛 태그를 메뉴명 줄 옆이 아니라 메뉴명 바로 아래 줄(설명 위)에 둔다
  assert.doesNotMatch(listTitleRow, /DescriptionTagLabels/);
  assert.doesNotMatch(card, /menu-side-tags/);
  const copy = card.match(/className="menu-copy"[\s\S]*?className="menu-side"/)?.[0] ?? "";
  assert.match(
    copy,
    /<\/div>\s*\{descriptionParts\.tags\.length \? \(\s*<div className="menu-taste-tags">\s*<DescriptionTagLabels tags=\{descriptionParts\.tags\} \/>\s*<\/div>\s*\) : null\}\s*\{descriptionParts\.body \?/,
  );
  // 상세 모달은 메뉴명 옆(가격 위)에 그대로 둔다
  assert.match(detailTitleRow, /<DescriptionTagLabels tags=\{descriptionParts\.tags\} \/>/);
  assert.doesNotMatch(styles, /menu-side-tags/);

  // 맛 태그는 ABV 라벨보다 조금 작다(글자·높이)
  const px = (rule: string, prop: string) => Number(rule.match(new RegExp(`${prop}:\\s*(\\d+)px`))?.[1]);
  const abvRule = styles.match(/\n\.menu-label-tag\s*\{([^}]*)\}/)?.[1] ?? "";
  const tasteRule = styles.match(/\.menu-taste-tags \.menu-label-tag\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(px(tasteRule, "font-size") < px(abvRule, "font-size"));
  assert.ok(px(tasteRule, "min-height") < px(abvRule, "min-height"));
  for (const name of ["notebook", "chalkboard"]) {
    const css = await readFile(new URL(`../app/templates/${name}.css`, import.meta.url), "utf8");
    assert.doesNotMatch(css, /menu-side-tags/, name);
    const templateLabel = css.match(new RegExp(`html\\[data-template="${name}"\\] \\.menu-label-tag\\[data-label-color\\] \\{([^}]*)\\}`))?.[1] ?? "";
    const templateTaste = css.match(new RegExp(`html\\[data-template="${name}"\\] \\.menu-taste-tags \\.menu-label-tag[^{]*\\{([^}]*)\\}`))?.[1] ?? "";
    assert.ok(px(templateTaste, "font-size") < px(templateLabel, "font-size"), name);
  }
  assert.doesNotMatch(card, /<p>\{item\.description\}<\/p>/);
  assert.match(styles, /\.menu-label-tag\[data-label-color="red"\]/);
});
