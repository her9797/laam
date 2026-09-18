import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

  assert.match(trigger, /"use client"/);
  assert.match(trigger, /from "canvas-confetti"/, "폭죽 라이브러리를 써야 한다");
  assert.match(trigger, /claimSecretCoupon\(/, "claim API를 호출해야 한다");
  assert.match(trigger, /"vinyl-laam"/, "LP 라벨용 쿠폰 id를 써야 한다");
  assert.match(trigger, /className="home-vinyl-secret"/, "기존 laam 텍스트와 같은 스타일을 써야 한다");
  assert.match(trigger, />\s*laam\s*</, "버튼 텍스트는 기존과 똑같이 laam이어야 한다");
  assert.match(trigger, /confetti\(/, "찾았을 때 폭죽을 터뜨려야 한다");
  assert.match(trigger, /rewardLabel/, "당첨된 쿠폰 이름을 보여줘야 한다");
  assert.match(trigger, /사장님께 보여주시면 실물과 교환해드립니다/, "사장님께 보여달라는 안내가 있어야 한다");
  assert.match(trigger, /쉿!크릿 쿠폰/, "쉿크릿 쿠폰 테마 문구가 있어야 한다");
  assert.match(trigger, /\/secret-coupon\/vinyl-laam-shh\.jpg/, "쉿 포즈 사진 에셋을 써야 한다");

  // 트리거 버튼이 LP 회전 애니메이션(vinyl-spin)이 걸린 조상 안에 있어서,
  // 모달을 그 자리에 그대로 렌더링하면 모달까지 같이 돈다. document.body로
  // 포탈을 태워야 한다 — menu-item-card.tsx의 상세 모달과 같은 이유.
  assert.match(trigger, /import\s+\{\s*createPortal\s*\}\s+from\s+"react-dom"/);
  assert.match(trigger, /createPortal\([\s\S]*document\.body,\s*\)/);

  // 쿠폰 모달은 실수로 배경을 눌러서 닫히면 안 된다 — 닫기 버튼으로만 닫혀야 한다.
  const backdropTag = trigger.match(/<div\s+className="table-session-modal-backdrop"[^>]*>/);
  assert.ok(backdropTag, "쿠폰 모달 백드롭 div가 있어야 한다");
  assert.doesNotMatch(
    backdropTag[0],
    /onClick/,
    "배경을 클릭해도 쿠폰 모달이 닫히면 안 된다",
  );
});
