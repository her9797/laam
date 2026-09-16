import { NextRequest, NextResponse } from "next/server";

import { getQrCookieName, isQrSessionValid } from "@/lib/auth";

const API_BASE_URL =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:9090";

export async function POST(request: NextRequest) {
  if (!isQrSessionValid(request.cookies.get(getQrCookieName())?.value)) {
    return NextResponse.json({ error: "QR 입장이 필요합니다." }, { status: 401 });
  }

  const token = process.env.PAYMENT_API_TOKEN ?? "lam-payment-api-token";
  const bodyBuffer = await request.arrayBuffer();
  const response = await fetch(`${API_BASE_URL}/api/v1/special-requests`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(request.headers.get("content-type")
        ? { "Content-Type": request.headers.get("content-type") as string }
        : {}),
    },
    body: bodyBuffer,
    cache: "no-store",
  });

  const responseBody = await response.arrayBuffer();
  const nextResponse = new NextResponse(responseBody, {
    status: response.status,
  });
  const contentType = response.headers.get("content-type");
  if (contentType) {
    nextResponse.headers.set("Content-Type", contentType);
  }
  return nextResponse;
}
