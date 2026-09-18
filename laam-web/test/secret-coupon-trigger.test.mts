import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("시크릿 쿠폰 히트박스 공통 로직과 모달", async () => {
  const hotspot = await readFile(
    new URL("../components/easter-egg/secret-coupon-hotspot.tsx", import.meta.url),
    "utf8",
  );

  assert.match(hotspot, /"use client"/);
  assert.match(hotspot, /from "canvas-confetti"/, "폭죽 라이브러리를 써야 한다");
  assert.match(hotspot, /claimSecretCoupon\(/, "claim API를 호출해야 한다");
  assert.match(hotspot, /confetti\(/, "찾았을 때 폭죽을 터뜨려야 한다");
  assert.match(hotspot, /rewardLabel/, "당첨된 쿠폰 이름을 보여줘야 한다");
  assert.match(hotspot, /사장님께 보여주시면 실물과 교환해드립니다/, "사장님께 보여달라는 안내가 있어야 한다");
  assert.match(hotspot, /쉿!크릿 쿠폰/, "쉿크릿 쿠폰 테마 문구가 있어야 한다");
  assert.match(hotspot, /\/secret-coupon\/vinyl-laam-shh\.jpg/, "쉿 포즈 사진 에셋을 써야 한다");

  // 히트박스가 회전 애니메이션이 걸린 조상 안에 있을 수도 있어서(LP 라벨 케이스),
  // 모달을 그 자리에 그대로 렌더링하면 모달까지 같이 돈다. document.body로
  // 포탈을 태워야 한다 — menu-item-card.tsx의 상세 모달과 같은 이유.
  assert.match(hotspot, /import\s+\{\s*createPortal\s*\}\s+from\s+"react-dom"/);
  assert.match(hotspot, /createPortal\([\s\S]*document\.body,\s*\)/);

  // 쿠폰 모달은 실수로 배경을 눌러서 닫히면 안 된다 — 닫기 버튼으로만 닫혀야 한다.
  const backdropTag = hotspot.match(/<div\s+className="table-session-modal-backdrop"[^>]*>/);
  assert.ok(backdropTag, "쿠폰 모달 백드롭 div가 있어야 한다");
  assert.doesNotMatch(
    backdropTag[0],
    /onClick/,
    "배경을 클릭해도 쿠폰 모달이 닫히면 안 된다",
  );
});

test("홈 화면 LP 라벨의 laam 텍스트는 시크릿 쿠폰 트리거다", async () => {
  const home = await readFile(
    new URL("../components/screens/home-screen.tsx", import.meta.url),
    "utf8",
  );
  const trigger = await readFile(
    new URL("../components/easter-egg/secret-coupon-trigger.tsx", import.meta.url),
    "utf8",
  );

  assert.match(home, /<SecretCouponTrigger/, "홈 화면이 트리거 컴포넌트를 렌더링해야 한다");

  assert.match(trigger, /from\s+"\.\/secret-coupon-hotspot"/, "공통 히트박스 로직을 재사용해야 한다");
  assert.match(trigger, /couponId="vinyl-laam"/, "LP 라벨용 쿠폰 id를 써야 한다");
  assert.match(trigger, /className="home-vinyl-secret"/, "기존 laam 텍스트와 같은 스타일을 써야 한다");
  assert.match(trigger, />\s*laam\s*</, "버튼 텍스트는 기존과 똑같이 laam이어야 한다");
});

test("우측 상단 테이블 뱃지는 손님 화면에서 두 번째 시크릿 쿠폰 트리거다", async () => {
  const badge = await readFile(
    new URL("../components/table/table-session-badge.tsx", import.meta.url),
    "utf8",
  );

  assert.match(badge, /from\s+"@\/components\/easter-egg\/secret-coupon-hotspot"/, "공통 히트박스 로직을 재사용해야 한다");

  // 손님 화면(!canEdit)에서만 트리거가 붙어야 한다 — 직원용(canEdit) 테이블 변경
  // 기능은 그대로 유지되어야 한다.
  const customerBranch = badge.match(/if \(!canEdit\) \{[\s\S]*?\n {2}\}/);
  assert.ok(customerBranch, "손님용(!canEdit) 분기를 찾을 수 있어야 한다");
  assert.match(customerBranch[0], /SecretCouponHotspot/, "손님 화면에는 시크릿 쿠폰 트리거가 붙어야 한다");
  assert.match(customerBranch[0], /couponId="table-badge"/, "테이블 뱃지용 쿠폰 id를 써야 한다");

  const staffButton = badge.match(/<button[\s\S]*?floating-table-badge[\s\S]*?<\/button>/);
  assert.ok(staffButton, "직원용 버튼을 찾을 수 있어야 한다");
  assert.doesNotMatch(
    staffButton[0],
    /SecretCouponHotspot/,
    "직원용 화면에는 시크릿 쿠폰 트리거가 붙으면 안 된다",
  );
});
