import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

// Resolve the same aliases as Next.js while exercising the real route handlers.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
  },
});
const { NextRequest } = await import("next/server.js");
const enterRoute = await import("../app/preview/enter/route.ts");
const exitRoute = await import("../app/preview/exit/route.ts");
const writeRoutes = [
  ["orders", await import("../app/api/orders/route.ts"), undefined],
  ["customer-requests", await import("../app/api/customer-requests/route.ts"), undefined],
  ["special-requests", await import("../app/api/special-requests/route.ts"), undefined],
  ["payments/orders", await import("../app/api/payments/orders/route.ts"), undefined],
  ["payments/confirm", await import("../app/api/payments/confirm/route.ts"), undefined],
  ["secret-coupons/vinyl-laam/claim", await import("../app/api/secret-coupons/[id]/claim/route.ts"), { params: Promise.resolve({ id: "vinyl-laam" }) }],
] as const;
const { createPreviewCookieValue } = await import("../lib/customer-template.ts");
const { canViewCustomerPage } = await import("../lib/preview-request.ts");
const { isQrSessionValid } = await import("../lib/auth.ts");
hooks.deregister();

const QR_SECRET = "test-qr-secret";
const SESSION_SECRET = "test-session-secret";

function withEnv(t: { after: (fn: () => void) => void }) {
  const original = { qr: process.env.QR_SIGNING_SECRET, session: process.env.SESSION_SECRET };
  process.env.QR_SIGNING_SECRET = QR_SECRET;
  process.env.SESSION_SECRET = SESSION_SECRET;
  t.after(() => {
    if (original.qr === undefined) delete process.env.QR_SIGNING_SECRET;
    else process.env.QR_SIGNING_SECRET = original.qr;
    if (original.session === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original.session;
  });
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function previewUrl(template: string, exp: number, sig?: string) {
  const signature = sig ?? createHmac("sha256", QR_SECRET).update(`preview:${template}:${exp}`).digest("hex");
  return `https://guest.example.com/preview/enter?template=${template}&exp=${exp}&sig=${signature}`;
}

function qrSession(expiresAt: number) {
  const payload = `v1.qr.${expiresAt}`;
  return `${payload}.${createHmac("sha256", SESSION_SECRET).update(payload).digest("hex")}`;
}

test("유효한 미리보기 링크는 주문할 수 있는 QR 세션 없이 30분짜리 미리보기 쿠키만 심고 홈으로 보낸다", async (t) => {
  withEnv(t);
  const response = await enterRoute.GET(new NextRequest(previewUrl("notebook", nowSeconds() + 600)));

  assert.equal(new URL(response.headers.get("location") ?? "").pathname, "/");
  const previewCookie = response.cookies.get("lam_template_preview");
  assert.match(previewCookie?.value ?? "", /^notebook\.\d+\.[0-9a-f]{64}$/);
  assert.equal(previewCookie?.maxAge, 1800);
  assert.equal(previewCookie?.httpOnly, true);
  // 미리보기 쿠키를 지워도 주문 가능한 세션이 남지 않고, 직원·손님의 기존 QR 세션도 덮지 않는다.
  assert.equal(response.cookies.get("lam_qr_session"), undefined);
});

test("미리보기 쿠키는 QR 세션 없이도 손님 화면을 열게 하지만 QR 세션을 대신하지는 않는다", async (t) => {
  withEnv(t);
  const preview = createPreviewCookieValue("notebook", nowSeconds() + 600, SESSION_SECRET);
  assert.equal(canViewCustomerPage(undefined, preview), true);
  assert.equal(canViewCustomerPage(qrSession(nowSeconds() + 600), undefined), true);
  assert.equal(canViewCustomerPage(undefined, undefined), false);
  assert.equal(canViewCustomerPage(undefined, preview.replace("notebook", "chalkboard")), false);
  assert.equal(isQrSessionValid(preview), false);
});

test("서명이 틀리거나 만료됐거나 모르는 템플릿이면 쿠키 없이 접근 안내로 보낸다", async (t) => {
  withEnv(t);
  const exp = nowSeconds() + 600;
  for (const url of [
    previewUrl("notebook", exp, "deadbeef"),
    previewUrl("notebook", nowSeconds() - 10),
    previewUrl("vinyl", exp),
  ]) {
    const response = await enterRoute.GET(new NextRequest(url));
    assert.equal(new URL(response.headers.get("location") ?? "").pathname, "/access-required", url);
    assert.equal(response.cookies.get("lam_qr_session"), undefined);
    assert.equal(response.cookies.get("lam_template_preview"), undefined);
  }
});

test("QR 서명 비밀값이 없으면 미리보기 입장을 막는다", async (t) => {
  withEnv(t);
  delete process.env.QR_SIGNING_SECRET;
  const response = await enterRoute.GET(new NextRequest(previewUrl("notebook", nowSeconds() + 600)));
  assert.equal(new URL(response.headers.get("location") ?? "").pathname, "/access-required");
});

test("미리보기 종료는 미리보기 쿠키만 지우고 QR·직원 세션은 남긴다", async (t) => {
  withEnv(t);
  const request = new NextRequest("https://guest.example.com/preview/exit", {
    headers: {
      cookie: `lam_template_preview=${createPreviewCookieValue("notebook", nowSeconds() + 600, SESSION_SECRET)}; lam_qr_session=${qrSession(nowSeconds() + 600)}; lam_staff_session=staff`,
    },
  });
  const response = await exitRoute.GET(request);

  assert.equal(new URL(response.headers.get("location") ?? "").pathname, "/");
  assert.equal(response.cookies.get("lam_template_preview")?.value, "");
  assert.equal(response.cookies.get("lam_qr_session"), undefined);
  assert.equal(response.cookies.get("lam_staff_session"), undefined);
});

for (const page of ["page", "menu/page", "menu/[category]/page", "song-requests/page", "requests/page", "special-requests/page", "events/page"]) {
  test(`app/${page}.tsx: 미리보기 쿠키로도 열 수 있다`, async () => {
    const source = await readFile(new URL(`../app/${page}.tsx`, import.meta.url), "utf8");
    assert.match(source, /canViewCustomerPage\(qrSession, cookieStore\.get\(PREVIEW_COOKIE_NAME\)\?\.value\)/);
  });
}

for (const [path, route, context] of writeRoutes) {
  test(`${path}: 미리보기 중에는 서버로 보내지 않고 403으로 거절한다`, async (t) => {
    withEnv(t);
    let fetched = false;
    t.mock.method(globalThis, "fetch", async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    });
    const request = new NextRequest(`https://guest.example.com/api/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `lam_template_preview=${createPreviewCookieValue("chalkboard", nowSeconds() + 600, SESSION_SECRET)}; lam_qr_session=${qrSession(nowSeconds() + 600)}`,
      },
      body: "{}",
    });
    const response = await (route.POST as (request: unknown, context?: unknown) => Promise<Response>)(request, context);

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "미리보기에서는 주문·요청을 보낼 수 없어요.");
    assert.equal(fetched, false);
  });
}
