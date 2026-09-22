import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("크러쉬 노래 신청에 발급된 쿠폰은 기존 모달과 폭죽으로 표시한다", async () => {
  const screen = await readFile(
    new URL("../components/screens/song-requests-screen.tsx", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL("../services/customer-request-service.ts", import.meta.url),
    "utf8",
  );

  assert.match(service, /secretCoupon/);
  assert.match(screen, /SecretCouponModal/);
  assert.match(screen, /claim=\{secretCoupon\}/);
  assert.match(screen, /canvas-confetti/);
  assert.match(screen, /particleCount:\s*140/);
});
