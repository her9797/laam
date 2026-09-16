import { NextRequest, NextResponse } from "next/server";

import { createQrSessionValue, getQrCookieMaxAge, getQrCookieName } from "@/lib/auth";
import {
  isCustomerTestEntryTokenValid,
  normalizeCustomerTestTable,
} from "@/lib/customer-test-entry";

function createEntryResponse(request: NextRequest, entryKey: string | null, tableValue: string | null) {
  const table = normalizeCustomerTestTable(tableValue ?? "T-01");
  const configuredToken = process.env.CUSTOMER_TEST_ENTRY_TOKEN ?? "";
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : request.nextUrl.origin;
  const redirectStatus = request.method === "POST" ? 303 : 307;

  if (!table || !isCustomerTestEntryTokenValid(configuredToken, entryKey)) {
    return NextResponse.redirect(new URL("/access-required", origin), redirectStatus);
  }

  const destination = new URL("/", origin);
  destination.searchParams.set("table", table);

  const response = NextResponse.redirect(destination, redirectStatus);
  response.cookies.set(getQrCookieName(), createQrSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getQrCookieMaxAge(),
  });

  return response;
}

export async function GET(request: NextRequest) {
  const entryKey = request.nextUrl.searchParams.get("key")?.replace(/ /g, "+") ?? null;
  const table = request.nextUrl.searchParams.get("table");

  return createEntryResponse(request, entryKey, table);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const entryKey = formData.get("key");
  const table = formData.get("table");

  return createEntryResponse(
    request,
    typeof entryKey === "string" ? entryKey : null,
    typeof table === "string" ? table : null,
  );
}
