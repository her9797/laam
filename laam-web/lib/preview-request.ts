import { NextResponse, type NextRequest } from "next/server";

import { getSessionSecret } from "./auth.ts";
import { PREVIEW_COOKIE_NAME, readPreviewCookie } from "./customer-template.ts";

export const PREVIEW_WRITE_BLOCKED_MESSAGE = "미리보기에서는 주문·요청을 보낼 수 없어요.";

export function readPreviewTemplate(cookieValue: string | undefined) {
  return readPreviewCookie(cookieValue, { secret: getSessionSecret(), now: Math.floor(Date.now() / 1000) });
}

/** 관리자 미리보기는 읽기 전용이다. 쓰기 라우트는 이 응답이 있으면 그대로 돌려준다. */
export function rejectPreviewWrite(request: NextRequest) {
  if (!readPreviewTemplate(request.cookies.get(PREVIEW_COOKIE_NAME)?.value)) {
    return null;
  }
  return NextResponse.json({ error: PREVIEW_WRITE_BLOCKED_MESSAGE }, { status: 403 });
}
