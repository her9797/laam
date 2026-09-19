import { NextRequest, NextResponse } from "next/server";

import { createQrSessionValue, getQrCookieMaxAge, getQrCookieName, isQrTableSignatureValid } from "@/lib/auth";
import { normalizeQrTable } from "@/lib/qr-table";

export async function GET(request: NextRequest) {
  const table = normalizeQrTable(request.nextUrl.searchParams.get("table"));
  const signature = request.nextUrl.searchParams.get("sig");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : request.nextUrl.origin;

  if (!table || !isQrTableSignatureValid(table, signature)) {
    return NextResponse.redirect(new URL("/access-required", origin));
  }

  const destination = new URL("/", origin);
  destination.searchParams.set("table", table);

  const response = NextResponse.redirect(destination);
  response.cookies.set(getQrCookieName(), createQrSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getQrCookieMaxAge(),
  });

  return response;
}
