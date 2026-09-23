import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("특별한 요청 폼의 이상형은 키·거주지·연령대·세부사항 4개 필드로 나뉘어 있다", async () => {
  const source = await readFile(
    new URL("../components/screens/requests-screen.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /idealType/, "단일 idealType 필드는 더 이상 남아 있으면 안 된다");

  for (const field of ["idealHeight", "idealResidence", "idealAgeRange", "idealDetails"]) {
    assert.match(source, new RegExp(`specialForm\\.${field}`), `${field} 상태를 읽는 곳이 있어야 한다`);
    assert.match(source, new RegExp(`${field}:\\s*event\\.target\\.value`), `${field}를 업데이트하는 핸들러가 있어야 한다`);
  }

  const fieldsetIndex = source.indexOf('className="request-compose-field-wide request-compose-fieldset"');
  assert.ok(fieldsetIndex >= 0, "이상형 4개 필드를 한 그룹으로 묶는 fieldset이 있어야 한다");

  const legendIndex = source.indexOf(">이상형<", fieldsetIndex);
  const idealHeightIndex = source.indexOf(">키<", fieldsetIndex);
  const idealResidenceIndex = source.indexOf(">거주지<", fieldsetIndex);
  const idealAgeRangeIndex = source.indexOf(">연령대<", fieldsetIndex);
  const idealDetailsIndex = source.indexOf(">세부사항<", fieldsetIndex);
  const fieldsetCloseIndex = source.indexOf("</fieldset>", fieldsetIndex);

  assert.ok(legendIndex > fieldsetIndex, "이상형 legend가 fieldset 열기 태그 다음에 와야 한다");
  assert.ok(idealHeightIndex > legendIndex, "키는 legend 다음에 와야 한다");
  assert.ok(idealResidenceIndex > idealHeightIndex, "거주지는 키 다음에 와야 한다");
  assert.ok(idealAgeRangeIndex > idealResidenceIndex, "연령대는 거주지 다음에 와야 한다");
  assert.ok(idealDetailsIndex > idealAgeRangeIndex, "세부사항은 연령대 다음에 와야 한다");
  assert.ok(
    fieldsetCloseIndex > idealDetailsIndex,
    "4개 필드 모두 같은 fieldset이 닫히기 전에 있어야 한다(같은 그룹 안에 있어야 함)",
  );
});

test("특별한 요청 제출 시 이상형 4개 필드가 모두 서버로 전달된다", async () => {
  const source = await readFile(
    new URL("../components/screens/requests-screen.tsx", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL("../services/customer-request-service.ts", import.meta.url),
    "utf8",
  );

  const createCallIndex = source.indexOf("await createSpecialRequest(");
  assert.ok(createCallIndex >= 0);
  const createCallBlock = source.slice(createCallIndex, createCallIndex + 600);
  for (const field of ["idealHeight", "idealResidence", "idealAgeRange", "idealDetails"]) {
    assert.match(createCallBlock, new RegExp(`${field}:`), `createSpecialRequest 호출에 ${field}가 있어야 한다`);
  }

  assert.doesNotMatch(service, /idealType/);
  for (const field of ["idealHeight", "idealResidence", "idealAgeRange", "idealDetails"]) {
    assert.match(service, new RegExp(`${field}:\\s*string`));
  }
});

test("사장님 칭찬 쿠폰은 기존 모달과 폭죽으로 표시한다", async () => {
  const screen = await readFile(
    new URL("../components/screens/requests-screen.tsx", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL("../services/customer-request-service.ts", import.meta.url),
    "utf8",
  );

  assert.match(service, /secretCoupon\?:\s*SecretCouponClaim/);
  assert.match(service, /createSpecialRequest[\s\S]*as CustomerRequestResult/);
  assert.match(screen, /SecretCouponModal/);
  assert.match(screen, /claim=\{secretCoupon\}/);
  assert.match(screen, /canvas-confetti/);
  assert.match(screen, /particleCount:\s*140/);
});
