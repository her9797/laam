import { NextResponse, type NextRequest } from "next/server";

import { getSessionSecret, isQrSessionValid } from "./auth.ts";
import { PREVIEW_COOKIE_NAME, readPreviewCookie } from "./customer-template.ts";

export const PREVIEW_WRITE_BLOCKED_MESSAGE = "미리보기에서는 주문·요청을 보낼 수 없어요.";

export function readPreviewTemplate(cookieValue: string | undefined) {
  return readPreviewCookie(cookieValue, { secret: getSessionSecret(), now: Math.floor(Date.now() / 1000) });
}

/**
 * 손님 화면은 QR 세션이나 관리자 미리보기 쿠키로 연다. 미리보기 쿠키는 QR 세션이 아니라서
 * 주문·요청 API(QR 세션 필요)로는 쓸 수 없다.
 */
export function canViewCustomerPage(qrSession: string | undefined, previewCookie: string | undefined) {
  return isQrSessionValid(qrSession) || readPreviewTemplate(previewCookie) !== null;
}

/** 관리자 미리보기는 읽기 전용이다. 쓰기 라우트는 이 응답이 있으면 그대로 돌려준다. */
export function rejectPreviewWrite(request: NextRequest) {
  if (!readPreviewTemplate(request.cookies.get(PREVIEW_COOKIE_NAME)?.value)) {
    return null;
  }
  return NextResponse.json({ error: PREVIEW_WRITE_BLOCKED_MESSAGE }, { status: 403 });
}
