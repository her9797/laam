import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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
const routes = [
  ["customer-requests", await import("../app/api/customer-requests/route.ts")],
  ["special-requests", await import("../app/api/special-requests/route.ts")],
] as const;
hooks.deregister();

function session(kind: string, expiresAt: number) {
  const payload = `v1.${kind}.${expiresAt}`;
  return `${payload}.${createHmac("sha256", "test-session-secret").update(payload).digest("hex")}`;
}

for (const [path, route] of routes) {
  test(`${path}: QR 인증 후에만 서버 토큰으로 원래 요청을 전달한다`, async (t) => {
    const originalSecret = process.env.SESSION_SECRET;
    const originalToken = process.env.PAYMENT_API_TOKEN;
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.PAYMENT_API_TOKEN = "test-server-token";
    t.after(() => {
      if (originalSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = originalSecret;
      if (originalToken === undefined) delete process.env.PAYMENT_API_TOKEN;
      else process.env.PAYMENT_API_TOKEN = originalToken;
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ status: "ok" }, { status: 201 });
    });
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ tableNumber: "T-01", text: "help" });
    const makeRequest = (value: string) => new NextRequest(`http://localhost/api/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: value ? `lam_qr_session=${value}` : "",
        Authorization: "Bearer browser-controlled-token",
      },
      body,
    });
    for (const cookie of ["", "forged", session("qr", now - 60), session("staff", now + 60)]) {
      const response = await route.POST(makeRequest(cookie));
      assert.equal(response.status, 401);
      assert.equal(calls.length, 0, "인증 실패 시 upstream을 호출하면 안 된다");
    }
    const response = await route.POST(makeRequest(session("qr", now + 60)));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, `/api/v1/${path}`);
    assert.equal(calls[0].init?.method, "POST");
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer test-server-token");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(new TextDecoder().decode(calls[0].init?.body as ArrayBuffer), body);
  });
}
