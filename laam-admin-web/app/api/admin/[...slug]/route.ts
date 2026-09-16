import { NextRequest, NextResponse } from "next/server";

import { getAdminCookieName, isAdminSessionValid } from "@/lib/auth/session";

function getApiBaseUrl(): string {
  const baseUrl = process.env.API_BASE_URL;
  if (!baseUrl) {
    throw new Error("API_BASE_URL 환경변수가 설정되어 있지 않습니다.");
  }
  return baseUrl;
}

function getAdminApiToken(): string {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    throw new Error("ADMIN_API_TOKEN 환경변수가 설정되어 있지 않습니다.");
  }
  return token;
}

const BODYLESS_METHODS = new Set(["GET", "HEAD", "DELETE"]);

// Each path segment must be a plain resource name/id: non-empty, no "/" and
// not "." or "..". Rejecting anything starting with "." covers both of
// those in one check. This is defense-in-depth against a segment escaping
// the intended "/api/v1/admin/" upstream prefix (e.g. "..") even though
// Next.js's own catch-all splitting shouldn't hand us such a thing.
const VALID_SLUG_SEGMENT = /^[^./][^/]*$/;

function isValidSlug(slug: string[]): boolean {
  return slug.length > 0 && slug.every((segment) => VALID_SLUG_SEGMENT.test(segment));
}

type RouteContext = { params: Promise<{ slug: string[] }> };

async function forward(request: NextRequest, slug: string[]) {
  const session = request.cookies.get(getAdminCookieName())?.value;
  if (!isAdminSessionValid(session)) {
    return NextResponse.json(
      { error: "관리자 인증이 필요합니다." },
      { status: 401 },
    );
  }

  if (!isValidSlug(slug)) {
    return NextResponse.json(
      { error: "잘못된 요청 경로입니다." },
      { status: 400 },
    );
  }

  const targetPath = slug.join("/");
  const bodyBuffer = BODYLESS_METHODS.has(request.method)
    ? undefined
    : await request.arrayBuffer();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${getAdminApiToken()}`,
  };
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const upstreamResponse = await fetch(
    `${getApiBaseUrl()}/api/v1/admin/${targetPath}${request.nextUrl.search}`,
    {
      method: request.method,
      headers,
      body: bodyBuffer,
      cache: "no-store",
    },
  );

  const responseBody = upstreamResponse.status === 204
    ? null
    : await upstreamResponse.arrayBuffer();
  const nextResponse = new NextResponse(responseBody, {
    status: upstreamResponse.status,
  });
  const responseContentType = upstreamResponse.headers.get("content-type");
  if (responseContentType) {
    nextResponse.headers.set("Content-Type", responseContentType);
  }
  return nextResponse;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  return forward(request, slug);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  return forward(request, slug);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  return forward(request, slug);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  return forward(request, slug);
}
