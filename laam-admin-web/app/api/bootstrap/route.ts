import { NextRequest, NextResponse } from "next/server";

import { normalizeAppDataImages } from "@/features/bootstrap/api";
import type { AppData } from "@/features/bootstrap/model";
import { getAdminCookieName, isAdminSessionValid } from "@/lib/auth/session";

function getApiBaseUrl(): string {
  const baseUrl = process.env.API_BASE_URL;
  if (!baseUrl) {
    throw new Error("API_BASE_URL 환경변수가 설정되어 있지 않습니다.");
  }
  return baseUrl;
}

/**
 * Session-gated BFF for the public `GET /api/v1/bootstrap` endpoint (no
 * admin token required upstream, unlike `/api/admin/*`). Two jobs live here
 * and nowhere else:
 *  - gate access behind the admin session cookie (the endpoint itself is
 *    public, so without this any visitor could read the full menu/notice
 *    tree through this BFF), and
 *  - normalize every relative `MenuImage.contentUrl` into an absolute API
 *    asset URL, so the browser never needs to know the upstream `laam-api`
 *    origin and no other code path re-implements this.
 */
export async function GET(request: NextRequest) {
  const session = request.cookies.get(getAdminCookieName())?.value;
  if (!isAdminSessionValid(session)) {
    return NextResponse.json(
      { error: "관리자 인증이 필요합니다." },
      { status: 401 },
    );
  }

  const apiBaseUrl = getApiBaseUrl();
  const upstreamResponse = await fetch(`${apiBaseUrl}/api/v1/bootstrap`, {
    method: "GET",
    cache: "no-store",
  });

  if (!upstreamResponse.ok) {
    const responseBody = await upstreamResponse.arrayBuffer();
    const nextResponse = new NextResponse(responseBody, {
      status: upstreamResponse.status,
    });
    const contentType = upstreamResponse.headers.get("content-type");
    if (contentType) {
      nextResponse.headers.set("Content-Type", contentType);
    }
    return nextResponse;
  }

  const data = (await upstreamResponse.json()) as AppData;
  return NextResponse.json(normalizeAppDataImages(data, apiBaseUrl));
}
