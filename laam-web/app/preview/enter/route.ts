import { NextRequest, NextResponse } from "next/server";

import { createQrSessionValue, getQrCookieName, getSessionSecret } from "@/lib/auth";
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

  const response = NextResponse.redirect(new URL("/", origin));
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PREVIEW_MAX_AGE_SECONDS,
  };
  // 미리보기 QR 세션도 30분만 산다. 종료하지 않고 떠나도 주문 가능한 세션이 남지 않는다.
  response.cookies.set(getQrCookieName(), createQrSessionValue(PREVIEW_MAX_AGE_SECONDS), options);
  response.cookies.set(
    PREVIEW_COOKIE_NAME,
    createPreviewCookieValue(template, now + PREVIEW_MAX_AGE_SECONDS, getSessionSecret()),
    options,
  );
  return response;
}
