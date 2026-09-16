import { NextRequest, NextResponse } from "next/server";

import { createQrSessionValue, createStaffSessionValue, getQrCookieMaxAge, getQrCookieName, getStaffCookieName, getStaffEntryToken } from "@/lib/auth";

export function GET(request: NextRequest) {
  const entryKey = request.nextUrl.searchParams.get("key")?.replace(/ /g, "+");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : request.nextUrl.origin;

  if (!getStaffEntryToken() || entryKey !== getStaffEntryToken()) {
    return NextResponse.redirect(new URL("/access-required", origin));
  }

  const response = NextResponse.redirect(new URL("/", origin));
  const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: getQrCookieMaxAge() };
  response.cookies.set(getQrCookieName(), createQrSessionValue(), options);
  response.cookies.set(getStaffCookieName(), createStaffSessionValue(), options);
  return response;
}
