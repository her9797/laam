import { NextRequest, NextResponse } from "next/server";

import { getQrCookieName, isQrSessionValid } from "@/lib/auth";

const API_BASE_URL =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:9090";

export function hasPaymentSession(request: NextRequest) {
  return isQrSessionValid(request.cookies.get(getQrCookieName())?.value);
}

export async function proxyPaymentRequest(request: NextRequest, path: string) {
  const token = process.env.PAYMENT_API_TOKEN ?? "lam-payment-api-token";
  const body = request.method === "GET" ? undefined : await request.arrayBuffer();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(request.headers.get("content-type")
        ? { "Content-Type": request.headers.get("content-type") as string }
        : {}),
    },
    body,
    cache: "no-store",
  });

  const responseBody = await response.arrayBuffer();
  const nextResponse = new NextResponse(responseBody, { status: response.status });
  const contentType = response.headers.get("content-type");
  if (contentType) {
    nextResponse.headers.set("Content-Type", contentType);
  }
  return nextResponse;
}
