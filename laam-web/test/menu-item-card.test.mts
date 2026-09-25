import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("메뉴 뱃지는 금액 영역 위에 있고 없는 메뉴도 빈 슬롯을 유지한다", async () => {
  const source = await readFile(
    new URL("../components/menu/menu-item-card.tsx", import.meta.url),
    "utf8",
  );

  const sideIndex = source.indexOf('className="menu-side"');
  const badgeIndex = source.indexOf("menu-badge-placeholder");
  const priceIndex = source.indexOf('className="menu-price"');

  assert.ok(sideIndex >= 0);
  assert.ok(badgeIndex > sideIndex);
  assert.ok(priceIndex > badgeIndex);
});

test("메뉴 목록 카드는 메뉴명 오른쪽에 라벨을 색상 태그로 표시한다", async () => {
  const source = await readFile(
    new URL("../components/menu/menu-item-card.tsx", import.meta.url),
    "utf8",
  );

  const copyIndex = source.indexOf('className="menu-copy"');
  const titleRowIndex = source.indexOf('className="menu-title-row"', copyIndex);
  const nameIndex = source.indexOf("<h3>{item.name}</h3>", copyIndex);
  const labelsIndex = source.indexOf('className="menu-labels"');
  const mapIndex = source.indexOf("item.labels.map(");
  const colorAttrIndex = source.indexOf("data-label-color");
  const descriptionIndex = source.indexOf("<p>{item.description}</p>", copyIndex);
  const sideIndex = source.indexOf('className="menu-side"');

  assert.ok(copyIndex >= 0);
  assert.ok(titleRowIndex > copyIndex && titleRowIndex < nameIndex);
  assert.ok(labelsIndex > nameIndex && labelsIndex < descriptionIndex);
  assert.ok(descriptionIndex < sideIndex);
  assert.ok(mapIndex > copyIndex && mapIndex < sideIndex);
  assert.ok(colorAttrIndex > copyIndex && colorAttrIndex < sideIndex);

  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const titleRowRule = styles.match(/\.menu-title-row\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(titleRowRule, /display:\s*flex/);
  assert.match(titleRowRule, /flex-wrap:\s*nowrap/);
  const titleRule = styles.match(/\.menu-title-row h3,\s*\.menu-title-row h2\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(titleRule, /min-width:\s*0/);
  const labelsRule = styles.match(/\.menu-title-row \.menu-labels\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(labelsRule, /flex-shrink:\s*0/);
});

test("메뉴 상세 모달은 기존 정보 오른쪽 위에 같은 메뉴 사진을 표시한다", async () => {
  const source = await readFile(
    new URL("../components/menu/menu-item-card.tsx", import.meta.url),
    "utf8",
  );

  const modalIndex = source.indexOf('className="table-session-modal menu-detail-modal"');
  const headerIndex = source.indexOf("menu-detail-header has-image", modalIndex);
  const imageIndex = source.indexOf('className="menu-detail-image"', modalIndex);
  const descriptionIndex = source.indexOf('className="menu-detail-description"', modalIndex);

  assert.ok(modalIndex >= 0);
  assert.ok(headerIndex > modalIndex);
  assert.ok(imageIndex > headerIndex);
  assert.ok(descriptionIndex > imageIndex);
});

test("메뉴 상세 모달도 메뉴명 오른쪽에 ABV 라벨을 표시한다", async () => {
  const source = await readFile(new URL("../components/menu/menu-item-card.tsx", import.meta.url), "utf8");
  const modalIndex = source.indexOf('className="table-session-modal menu-detail-modal"');
  const titleRowIndex = source.indexOf('className="menu-title-row menu-detail-title-row"', modalIndex);
  const nameIndex = source.indexOf('<h2 id={titleId}>{detail.name}</h2>', titleRowIndex);
  const labelsIndex = source.indexOf('className="menu-labels"', nameIndex);
  const priceIndex = source.indexOf('className="menu-detail-price"', labelsIndex);

  assert.ok(modalIndex >= 0);
  assert.ok(titleRowIndex > modalIndex && titleRowIndex < nameIndex);
  assert.ok(labelsIndex > nameIndex && labelsIndex < priceIndex);
});

test("메뉴 상세 사진은 오른쪽 위의 작은 정사각형 썸네일이다", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const imageRule = styles.match(/\.menu-detail-image\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(imageRule, /width:\s*88px/);
  assert.match(imageRule, /height:\s*88px/);
});

test("메뉴 상세 모달은 화면을 기준으로 가운데에 고정되도록 body에 렌더링한다", async () => {
  const source = await readFile(
    new URL("../components/menu/menu-item-card.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /import\s+\{\s*createPortal\s*\}\s+from\s+"react-dom"/);
  assert.match(source, /createPortal\([\s\S]*document\.body,\s*\)/);
});
