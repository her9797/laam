import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  PREVIEW_MAX_AGE_SECONDS,
  createPreviewCookieValue,
  readPreviewCookie,
  resolveCustomerTemplate,
  signPreviewLink,
  verifyPreviewLink,
} from "../lib/customer-template.ts";

const SECRET = "qr-secret";
const NOW = 1_800_000_000;

test("템플릿 값이 없거나 모르는 값이면 classic으로 정한다", () => {
  assert.equal(resolveCustomerTemplate(undefined), "classic");
  assert.equal(resolveCustomerTemplate(""), "classic");
  assert.equal(resolveCustomerTemplate("vinyl"), "classic");
  assert.equal(resolveCustomerTemplate(42), "classic");
  assert.equal(resolveCustomerTemplate("notebook"), "notebook");
  assert.equal(resolveCustomerTemplate("chalkboard"), "chalkboard");
});

test("미리보기 링크 서명은 laam-api와 같은 'preview:템플릿:만료' HMAC hex다", () => {
  const expected = createHmac("sha256", SECRET).update(`preview:notebook:${NOW}`).digest("hex");
  assert.equal(signPreviewLink(SECRET, "notebook", String(NOW)), expected);
  // 테이블 QR 서명(HMAC(table))과 섞이지 않는다.
  assert.notEqual(signPreviewLink(SECRET, "notebook", String(NOW)), createHmac("sha256", SECRET).update("notebook").digest("hex"));
});

test("유효한 미리보기 링크는 템플릿을 돌려준다", () => {
  const exp = String(NOW + 600);
  const sig = signPreviewLink(SECRET, "chalkboard", exp);
  assert.equal(verifyPreviewLink({ template: "chalkboard", exp, sig }, { secret: SECRET, now: NOW }), "chalkboard");
});

test("서명이 틀리거나 만료됐거나 모르는 템플릿이거나 비밀값이 없으면 거절한다", () => {
  const exp = String(NOW + 600);
  const sig = signPreviewLink(SECRET, "notebook", exp);
  assert.equal(verifyPreviewLink({ template: "notebook", exp, sig: "00" }, { secret: SECRET, now: NOW }), null);
  assert.equal(verifyPreviewLink({ template: "chalkboard", exp, sig }, { secret: SECRET, now: NOW }), null);
  assert.equal(verifyPreviewLink({ template: "notebook", exp, sig }, { secret: SECRET, now: NOW + 601 }), null);
  assert.equal(verifyPreviewLink({ template: "notebook", exp, sig }, { secret: "", now: NOW }), null);
  assert.equal(verifyPreviewLink({ template: null, exp, sig }, { secret: SECRET, now: NOW }), null);
  const vinylExp = String(NOW + 60);
  assert.equal(
    verifyPreviewLink({ template: "vinyl", exp: vinylExp, sig: signPreviewLink(SECRET, "vinyl", vinylExp) }, { secret: SECRET, now: NOW }),
    null,
  );
});

test("만료가 30분보다 먼 링크는 서명이 맞아도 거절한다", () => {
  const exp = String(NOW + PREVIEW_MAX_AGE_SECONDS + 120);
  const sig = signPreviewLink(SECRET, "notebook", exp);
  assert.equal(verifyPreviewLink({ template: "notebook", exp, sig }, { secret: SECRET, now: NOW }), null);
});

test("미리보기 쿠키는 서명이 맞고 만료 전일 때만 템플릿을 돌려준다", () => {
  const value = createPreviewCookieValue("notebook", NOW + 600, "session-secret");
  assert.equal(readPreviewCookie(value, { secret: "session-secret", now: NOW }), "notebook");
  assert.equal(readPreviewCookie(value, { secret: "other", now: NOW }), null);
  assert.equal(readPreviewCookie(value, { secret: "session-secret", now: NOW + 601 }), null);
  assert.equal(readPreviewCookie(value.replace("notebook", "chalkboard"), { secret: "session-secret", now: NOW }), null);
  assert.equal(readPreviewCookie(undefined, { secret: "session-secret", now: NOW }), null);
  assert.equal(readPreviewCookie("garbage", { secret: "session-secret", now: NOW }), null);
});
