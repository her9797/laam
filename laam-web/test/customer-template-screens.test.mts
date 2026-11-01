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
    [notebook, 'html[data-template="notebook"] .notebook-social a'],
    [chalkboard, 'html[data-template="chalkboard"] .chalk-social a'],
    [globals, ".template-preview-banner a"],
  ] as const) {
    const rule = block(css, selector);
    const size = Number(rule.match(/(?:min-)?height:\s*(\d+)px/)?.[1] ?? 0);
    assert.ok(size >= 44, `${selector}: ${size}px`);
  }
});

for (const [name, minTextPx] of [["notebook", 12], ["chalkboard", 12]] as const) {
  test(`${name}.css: ui-ux-pro-max 검토 — 포커스 링·placeholder·터치 간격·최소 글자 크기`, async () => {
    const css = await source(`app/templates/${name}.css`);
    const scope = `html[data-template="${name}"]`;

    // 키보드 포커스가 템플릿 배경 위에서 보이도록 2px 이상 링을 준다(입력칸 포함).
    const focus = css.match(new RegExp(`${scope.replace(/[[\]"]/g, "\\$&")} :focus-visible[^{]*\\{([^}]*)\\}`));
    assert.ok(focus, "템플릿 전용 :focus-visible 규칙이 있어야 한다");
    assert.match(focus[1], /outline:\s*[3-4]px solid/);
    assert.doesNotMatch(css, /outline:\s*none/, "포커스 링을 지우는 규칙이 없어야 한다");

    // 입력칸 안내 문구도 본문 대비(4.5:1)를 지키는 색을 쓴다.
    assert.match(css, /::placeholder\s*\{[^}]*color:/);

    // 페이지 이동 버튼·선택칸도 44px 이상.
    assert.match(css, /\.customer-menu-page-controls button[^{]*\{[^}]*min-height:\s*44px/);
    assert.match(css, /\.request-compose-field select[^{]*\{[^}]*min-height:\s*44px/);

    // 12px 미만 글자가 없어야 한다.
    for (const match of css.matchAll(/font-size:\s*([\d.]+)px/g)) {
      assert.ok(Number(match[1]) >= minTextPx, `font-size ${match[1]}px`);
    }
  });
}

test("누르는 요소가 붙어 있는 목록은 8px 이상 간격을 둔다", async () => {
  const notebook = await source("app/templates/notebook.css");
  const chalkboard = await source("app/templates/chalkboard.css");
  const gapOf = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `${selector} 규칙이 있어야 한다`);
    const block = css.slice(start, css.indexOf("}", start));
    return Number(block.match(/(?:row-)?gap:\s*(\d+)px/)?.[1] ?? 0);
  };
  assert.ok(gapOf(notebook, 'html[data-template="notebook"] .notebook-index-tabs') >= 8);
  assert.ok(gapOf(notebook, 'html[data-template="notebook"] .notebook-todo') >= 8);
  assert.ok(gapOf(chalkboard, 'html[data-template="chalkboard"] .chalk-nav') >= 8);
  assert.ok(gapOf(chalkboard, 'html[data-template="chalkboard"] .primary-strip') >= 8);
});

for (const name of ["notebook", "chalkboard"]) {
  test(`${name}.css: 관리자가 고른 라벨 색 4가지를 템플릿 톤으로 구분해 보여준다`, async () => {
    const css = await source(`app/templates/${name}.css`);
    const colors = new Set<string>();
    for (const color of ["green", "amber", "pink", "blue"]) {
      const rule = css.match(
        new RegExp(`html\\[data-template="${name}"\\] \\.menu-label-tag\\[data-label-color="${color}"\\]\\s*\\{([^}]*)\\}`),
      );
      assert.ok(rule, `${color} 라벨 규칙이 있어야 한다`);
      const value = rule[1].match(/(?:^|;|\s)color:\s*([^;]+);/)?.[1]?.trim();
      assert.ok(value, `${color} 라벨 글자색`);
      colors.add(value);
    }
    assert.equal(colors.size, 4, "네 색이 서로 달라야 한다");
  });
}

for (const name of ["notebook", "chalkboard"]) {
  test(`${name}.css: 라벨이 많아도 메뉴 이름을 글자 단위로 끊지 않고 라벨을 다음 줄로 내린다`, async () => {
    const css = await source(`app/templates/${name}.css`);
    const scope = `html\\[data-template="${name}"\\]`;
    assert.match(css, new RegExp(`${scope} \\.menu-title-row[^{]*\\{[^}]*flex-wrap:\\s*wrap`));
    assert.match(css, new RegExp(`${scope} \\.menu-title-row h3[^{]*\\{[^}]*word-break:\\s*keep-all`));
  });
}

test("chalkboard.css: 글자 자리는 기본으로 숨기고 사진이 있을 때만 썸네일을 보여준다(:has 미지원 브라우저는 예전처럼 글씨만)", async () => {
  const css = (await source("app/templates/chalkboard.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /html\[data-template="chalkboard"\] \.menu-icon\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.menu-icon:has\(\.menu-icon-image\)\s*\{[^}]*display:\s*grid/);
  assert.doesNotMatch(css, /:not\(:has\(/, "미지원 브라우저에서 무시되면 글자 자리가 다시 나타난다");
  assert.match(css, /\.menu-item:has\(\.menu-icon-image\)\s*\{[^}]*grid-template-columns:/);
});

for (const name of ["notebook", "chalkboard"]) {
  test(`${name}.css: 320px보다 좁은 화면(폴드 접힘 280px)에서도 잘리지 않게 body 최소 폭을 풀어 준다`, async () => {
    const css = await source(`app/templates/${name}.css`);
    assert.match(css, new RegExp(`html\\[data-template="${name}"\\] body\\s*\\{[^}]*min-width:\\s*0`));
  });
}

test("chalkboard.css: 사진이 있는 메뉴는 가격을 설명 아래로 내려 좁은 화면에서도 이름이 끊기지 않는다", async () => {
  const css = await source("app/templates/chalkboard.css");
  assert.match(css, /\.menu-item:has\(\.menu-icon-image\)\s*\{[^}]*grid-template-columns:\s*64px minmax\(0, 1fr\);/);
  assert.match(css, /\.menu-item:has\(\.menu-icon-image\) \.menu-side\s*\{[^}]*grid-column:\s*2/);
});

test("미리보기 띠는 좁은 화면에서 줄바꿈되어 종료 버튼이 잘리지 않는다", async () => {
  const css = await source("app/globals.css");
  assert.match(css, /\.template-preview-banner\s*\{[^}]*flex-wrap:\s*wrap/);
});

for (const [name, itemSelector] of [
  ["notebook", 'html\\[data-template="notebook"\\] \\.menu-item'],
  ["chalkboard", 'html\\[data-template="chalkboard"\\] \\.menu-item:has\\(\\.menu-icon-image\\)'],
] as const) {
  test(`${name}.css: 설명이 없는 메뉴도 가격이 이름 바로 아래 붙는다(사진 칸이 두 줄에 걸침, 빈 설명 숨김)`, async () => {
    const css = await source(`app/templates/${name}.css`);
    assert.match(css, new RegExp(`${itemSelector}\\s*\\{[^}]*grid-template-rows:\\s*auto 1fr`));
    assert.match(css, new RegExp(`${itemSelector} \\.menu-icon\\s*\\{[^}]*grid-row:\\s*1 / span 2`));
    assert.match(css, new RegExp(`html\\[data-template="${name}"\\] \\.menu-copy p:empty\\s*\\{[^}]*display:\\s*none`));
  });
}

test("chalkboard.css: 빈 배지 자리를 없애 사진 없는 메뉴도 이름과 가격이 한 줄에 놓인다", async () => {
  const css = await source("app/templates/chalkboard.css");
  assert.match(css, /html\[data-template="chalkboard"\] \.menu-badge-placeholder\s*\{[^}]*display:\s*none/);
});

test("공책·칠판 본문 글꼴은 나눔고딕이다(손글씨 제목 글꼴은 그대로)", async () => {
  const layout = await source("app/layout.tsx");
  assert.match(layout, /Nanum_Gothic\(\{ weight: \["400", "700"\], preload: false, variable: "--font-nanum-gothic"/);
  assert.doesNotMatch(layout, /Gowun_Dodum/);
  for (const name of ["notebook", "chalkboard"]) {
    const css = await source(`app/templates/${name}.css`);
    assert.match(css, /font-family: var\(--font-nanum-gothic\)/, name);
    assert.doesNotMatch(css, /--font-gowun-dodum/, name);
  }
});

test("카테고리 화면 머리글에 '…전체 메뉴' 설명 문구를 두지 않는다", async () => {
  const screen = await source("components/screens/category-screen.tsx");
  assert.doesNotMatch(screen, /전체 메뉴/);
  assert.doesNotMatch(screen, /hero-copy/);
});

test("모바일에서 누른 자리에 브라우저 기본 탭 하이라이트(잔상)를 그리지 않는다", async () => {
  const css = await source("app/globals.css");
  assert.match(css, /(^|\n)body\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/);
});

test("notebook.css: 스프링은 왼쪽, 인덱스 탭은 위에 가로로 두어 오른쪽 폭을 본문에 돌려준다", async () => {
  const css = (await source("app/templates/notebook.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const chrome = await source("components/templates/template-chrome.tsx");
  assert.doesNotMatch(chrome, /notebook-spiral/, "위쪽 스프링 마크업 대신 CSS 배경 고리를 쓴다");
  assert.doesNotMatch(css, /notebook-spiral/);
  assert.match(css, /--nb-sheet:\s*min\(440px, calc\(100vw - 16px\)\)/);
  assert.match(css, /html\[data-template="notebook"\] \.page-shell::before\s*\{[^}]*repeat-y/);
  assert.match(css, /html\[data-template="notebook"\] \.notebook-index-tabs\s*\{[^}]*top:\s*0;[^}]*flex-direction:\s*row/);
  assert.doesNotMatch(css, /writing-mode:\s*vertical-rl/);
  assert.match(css, /body:has\(\.template-preview-banner\) \.notebook-index-tabs\s*\{[^}]*top:/, "미리보기 띠 아래로 탭을 내린다");
});

test("chalkboard.css: 바깥 여백과 나무 틀을 줄여 좁은 화면에서 본문 폭을 넓힌다", async () => {
  const css = await source("app/templates/chalkboard.css");
  assert.match(css, /html\[data-template="chalkboard"\] \.page-shell\s*\{[^}]*width:\s*min\(430px, calc\(100% - 16px\)\);[^}]*border:\s*6px solid/);
});

test("공책·칠판 손글씨 글자를 한 단계(약 10%) 줄인다", async () => {
  const notebook = await source("app/templates/notebook.css");
  const chalkboard = await source("app/templates/chalkboard.css");
  assert.match(notebook, /\.hero-card h1,[\s\S]*?font-size:\s*clamp\(26px, 8vw, 34px\)/);
  assert.match(chalkboard, /\.hero-card h1,[\s\S]*?font-size:\s*49px/);
});

test("공책·칠판 홈은 인스타·네이버를 이름이 붙은 아이콘 링크로 보여준다", async () => {
  const links = await source("components/templates/social-links.tsx");
  assert.match(links, /aria-label="인스타그램 @bar_laam"/);
  assert.match(links, /aria-label="네이버 지도"/);
  assert.equal(links.match(/target="_blank" rel="noreferrer"/g)?.length, 2);

  const notebook = await source("components/templates/notebook-home-screen.tsx");
  assert.match(notebook, /<SocialLinks className="notebook-social" \/>/);
  assert.doesNotMatch(notebook, /notebook-links/);
  const chalkboard = await source("components/templates/chalkboard-home-screen.tsx");
  assert.match(chalkboard, /<SocialLinks className="chalk-social" \/>/);
});

test("notebook.css: 스크롤해서 위에 붙는 카테고리 바가 고정 인덱스 탭(58px) 밑에 가려지지 않는다", async () => {
  const css = await source("app/templates/notebook.css");
  assert.match(css, /html\[data-template="notebook"\] \.floating-subnav-shell\s*\{[^}]*top:\s*58px/);
  assert.match(css, /body:has\(\.template-preview-banner\) \.floating-subnav-shell\s*\{[^}]*top:\s*118px/, "미리보기 띠(60px)만큼 더 내린다");
});
