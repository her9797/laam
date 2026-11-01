import { NextRequest, NextResponse } from "next/server";

import { getQrCookieName } from "@/lib/auth";
import { PREVIEW_COOKIE_NAME } from "@/lib/customer-template";

export function GET(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : request.nextUrl.origin;

  const response = NextResponse.redirect(new URL("/access-required", origin));
  // 미리보기로 받은 QR 세션만 지운다. 미리보기가 아닌 손님의 세션은 건드리지 않는다.
  if (request.cookies.has(PREVIEW_COOKIE_NAME)) {
    response.cookies.delete(PREVIEW_COOKIE_NAME);
    response.cookies.delete(getQrCookieName());
  }
  return response;
}
