import { NextRequest, NextResponse } from "next/server";

import { hasPaymentSession, proxyPaymentRequest } from "@/lib/payment-api-server";

export async function POST(request: NextRequest) {
  if (!hasPaymentSession(request)) {
    return NextResponse.json({ error: "QR access required" }, { status: 401 });
  }
  return proxyPaymentRequest(request, "/api/v1/orders");
}
