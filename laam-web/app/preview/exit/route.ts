import { NextRequest, NextResponse } from "next/server";

import { PREVIEW_COOKIE_NAME } from "@/lib/customer-template";

export function GET(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : request.nextUrl.origin;

  // 미리보기 쿠키만 지운다. QR 세션이 있던 직원·손님은 원래 템플릿 홈으로, 없으면 홈이 접근 안내로 보낸다.
  const response = NextResponse.redirect(new URL("/", origin));
  response.cookies.delete(PREVIEW_COOKIE_NAME);
  return response;
}
