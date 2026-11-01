import { NextRequest, NextResponse } from "next/server";

import { getSessionSecret } from "@/lib/auth";
import {
  PREVIEW_COOKIE_NAME,
  PREVIEW_MAX_AGE_SECONDS,
  createPreviewCookieValue,
  verifyPreviewLink,
} from "@/lib/customer-template";

export function GET(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : request.nextUrl.origin;
  const now = Math.floor(Date.now() / 1000);
  const params = request.nextUrl.searchParams;

  const template = verifyPreviewLink(
    { template: params.get("template"), exp: params.get("exp"), sig: params.get("sig") },
    { secret: process.env.QR_SIGNING_SECRET ?? "", now },
  );
  if (!template) {
    return NextResponse.redirect(new URL("/access-required", origin));
  }

  // QR 세션은 주지 않는다. 미리보기 쿠키는 화면만 열고(canViewCustomerPage), 주문·요청 API는
  // QR 세션을 요구하므로 쿠키를 지워도 주문 가능한 세션이 남지 않는다.
  const response = NextResponse.redirect(new URL("/", origin));
  response.cookies.set(
    PREVIEW_COOKIE_NAME,
    createPreviewCookieValue(template, now + PREVIEW_MAX_AGE_SECONDS, getSessionSecret()),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: PREVIEW_MAX_AGE_SECONDS,
    },
  );
  return response;
}
