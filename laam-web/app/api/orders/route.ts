import { NextRequest, NextResponse } from "next/server";

import { hasPaymentSession, proxyPaymentRequest } from "@/lib/payment-api-server";
import { rejectPreviewWrite } from "@/lib/preview-request";

export async function POST(request: NextRequest) {
  const previewBlocked = rejectPreviewWrite(request);
  if (previewBlocked) {
    return previewBlocked;
  }
  if (!hasPaymentSession(request)) {
    return NextResponse.json({ error: "QR access required" }, { status: 401 });
  }
  return proxyPaymentRequest(request, "/api/v1/orders");
}
