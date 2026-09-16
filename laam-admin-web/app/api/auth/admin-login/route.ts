import { NextRequest, NextResponse } from "next/server";

import {
  checkLoginAllowed,
  getClientIp,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/auth/login-rate-limit";
import {
  createAdminSessionValue,
  getAdminCookieMaxAgeSeconds,
  getAdminCookieName,
  timingSafeEqualString,
} from "@/lib/auth/session";

function getAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD 환경변수가 설정되어 있지 않습니다.");
  }
  return password;
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as
    | { password?: string }
    | null;
  // Compared exactly as submitted, with no trim: the password is an opaque
  // secret, and surrounding whitespace may be part of ADMIN_PASSWORD.
  const password = payload?.password ?? "";

  // Invariant: from checkLoginAllowed through recordLoginFailure /
  // recordLoginSuccess below there must be no `await`. Any yield in between
  // lets a parallel burst of requests all pass the check before any failure
  // is recorded, bypassing both the per-IP and global limits.
  const clientIp = getClientIp(request.headers);
  const allowance = checkLoginAllowed(clientIp);
  if (!allowance.allowed) {
    return NextResponse.json(
      { error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(allowance.retryAfterSeconds) },
      },
    );
  }

  if (!password || !timingSafeEqualString(password, getAdminPassword())) {
    // Every 401 counts, including an empty password or malformed JSON: the
    // login form always sends JSON, so those only come from a stray empty
    // submit (a few at most) or a non-browser client probing the endpoint,
    // and exempting them would give scripts free requests that bypass the
    // limit's bookkeeping.
    recordLoginFailure(clientIp);
    return NextResponse.json(
      { error: "비밀번호가 올바르지 않습니다." },
      { status: 401 },
    );
  }

  recordLoginSuccess(clientIp);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(getAdminCookieName(), createAdminSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getAdminCookieMaxAgeSeconds(),
  });

  return response;
}
