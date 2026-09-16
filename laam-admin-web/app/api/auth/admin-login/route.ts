import { NextRequest, NextResponse } from "next/server";

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
  const password = payload?.password?.trim() ?? "";

  if (!password || !timingSafeEqualString(password, getAdminPassword())) {
    return NextResponse.json(
      { error: "비밀번호가 올바르지 않습니다." },
      { status: 401 },
    );
  }

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
