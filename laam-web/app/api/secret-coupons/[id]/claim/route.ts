import { NextRequest, NextResponse } from "next/server";

import { hasPaymentSession, proxyPaymentRequest } from "@/lib/payment-api-server";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!hasPaymentSession(request)) {
    return NextResponse.json({ error: "QR 입장이 필요합니다." }, { status: 401 });
  }
  const { id } = await context.params;
  return proxyPaymentRequest(request, `/api/v1/secret-coupons/${encodeURIComponent(id)}/claim`);
}
